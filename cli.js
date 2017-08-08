#!/usr/bin/env node
'use strict';
const fs = require('fs');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
const crypto = require('crypto');
const chalk = require('chalk');
const inquirer = require('inquirer');
const escExit = require('esc-exit');
const cliTruncate = require('cli-truncate');
const meow = require('meow');
const fileHound = require('filehound');
const md5File = require('md5-file');
const ora = require('ora');
const updateNotifier = require('update-notifier');
const hasFlag = require('has-flag');
const pkg = require('./package.json');

const log = console.log;

updateNotifier({pkg}).notify();

const SETTINGS_FILE_NAME = '.tasks.cache';

const cli = meow(`
	Usage
		$ gradlr

	Options
		-o, --offline  Execute the build without accessing network resources
		-f, --force    Force to re-index the tasks

	Examples
		$ gradlr
		$ gradlr --force
		$ gradlr --offline

	Run without arguments to use the interactive interface.
`, {
	alias: {
		f: 'force',
		o: 'offline',
		v: 'version'
	},
	boolean: [
		'force',
		'offline',
		'version'
	]
});

const commandLineMargins = 4;

// =======================
// Main Code

const force = hasFlag('-f') || hasFlag('--force');
const offline = hasFlag('-o') || hasFlag('--offline');

if (!isValidGradleProject()) {
	console.log(chalk.red.bgBlack('This is not a valid gradle project'));
	process.exit();
}

if (force) {
	resetConfig();
}

init(cli.flags);

// =======================

function init(flags) {
	escExit();
	return getTasks()
		.then(tasks => listAvailableTasks(tasks, flags))
		.catch(err => {
			console.log(chalk.red(err));
			process.exit();
		});
}

function isValidGradleProject() {
	return fs.existsSync('build.gradle');
}

function parseGradleTasks(stdout) {
	const lines = stdout.split('\n');
	const items = [];
	const cleanseItems = [];
	let startingPlace = -1;

	lines.forEach((item, i) => {
		if (startingPlace > -1 && i <= startingPlace) {
			return;
		}

		if (item.startsWith('All tasks runnable from root project')) {
			startingPlace = i + 4;
			return;
		}

		if (startingPlace === -1) {
			return;
		}

		if (/^\s*$/.test(item)) {
			return;
		}

		const nextLineStartsWithDashes = lines[i + 1].startsWith('---');

		if (item.startsWith('---') || nextLineStartsWithDashes) {
			return;
		}

		cleanseItems.push(item);
	});

	// Common missing items
	cleanseItems.push('javadoc - Generates Javadoc API documentation for the main source code');
	cleanseItems.push('test - Runs the unit tests.');
	cleanseItems.push('check - Runs all checks');
	cleanseItems.push('dependencies - Displays all dependencies declared in root project ');
	cleanseItems.push('wrapper - Generates Gradle wrapper files.');
	cleanseItems.push('assemble - Assembles the outputs of this project.');
	cleanseItems.push('build - Assembles and tests this project.');
	cleanseItems.push('buildDependents - Assembles and tests this project and all projects that depend on it.');
	cleanseItems.push('buildNeeded - Assembles and tests this project and all projects it depends on.');
	cleanseItems.push('classes - Assembles main classes.');
	cleanseItems.push('clean - Deletes the build directory.');
	cleanseItems.push('jar - Assembles a jar archive containing the main classes.');
	cleanseItems.push('testClasses - Assembles test classes.');

	cleanseItems.forEach(item => {
		const separation = item.split(' - ');
		const name = separation[0];
		const description = separation.length === 2 ? separation[1] : '';
		items.push({name, description});
	});
	return items;
}

function isCacheDirty(previousChecksum, previousGradlrVersion) {
	return getChecksumOfGradleFiles('.')
		.then(sum => previousChecksum !== sum || previousGradlrVersion !== pkg.version);
}

function getTasksFromCache() {
	return new Promise((resolve, reject) => {
		const spinner = ora({
			color: 'yellow',
			text: 'Parsing gradle tasks...'
		}).start();

		exec('./gradlew -q tasks --all', (error, stdout) => {
			spinner.stop();
			const items = parseGradleTasks(stdout);
			if (items.length === 0) {
				reject(error);
			} else {
				getChecksumOfGradleFiles('.')
					.then(sum => {
						saveSettings({
							timestamp: Date.now(),
							generatedWith: 'https://github.com/cesarferreira/gradlr',
							checksum: sum,
							gradlrVersion: pkg.version,
							payload: items.sort(keysrt('name'))
						})
						.then(data => resolve(data.payload));
					});
			}
		});
	});
}

function getTasks() {
	return new Promise((resolve, reject) => {
		readSettings()
				.then(settings => {
					isCacheDirty(settings.checksum, settings.gradlrVersion)
						.then(isItDirty => {
							if (isItDirty) {
								resetConfig();
								getTasksFromCache()
									.then(data => resolve(data))
									.catch(err => reject(err));
							} else {
								resolve(settings.payload);
							}
						});
				})
				.catch(() => {
					getTasksFromCache()
						.then(data => resolve(data))
						.catch(err => reject(err));
				});
	});
}

function saveSettings(data) {
	return new Promise((resolve, reject) => {
		fs.writeFile(`${SETTINGS_FILE_NAME}.json`, JSON.stringify(data), 'utf-8', err => {
			if (err) {
				reject(err);
			} else {
				resolve(data);
			}
		});
	});
}

function readSettings() {
	return new Promise((resolve, reject) => {
		fs.readFile(`${SETTINGS_FILE_NAME}.json`, 'utf-8', (err, data) => {
			if (err) {
				reject(err);
			} else {
				promisedParseJSON(data)
					.then(data => resolve(data))
					.catch(err => reject(err));
			}
		});
	});
}

function promisedParseJSON(json) {
	return new Promise((resolve, reject) => {
		try {
			resolve(JSON.parse(json));
		} catch (err) {
			reject(err);
		}
	});
}

function listAvailableTasks(processes, flags) {
	inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));
	return inquirer.prompt([{
		name: 'target',
		message: 'Available tasks:',
		type: 'autocomplete',
		pageSize: 10,
		source: (answers, input) => Promise.resolve().then(() => filterTasks(input, processes, flags))
	}])
	.then(answer => execute(answer));
}

function execute(task) {
	const params = [task.target];
	if (offline) {
		params.push('--offline');
	}
	log(`Running: ${chalk.green.bold(params.join(' '))}\n`);
	spawn('./gradlew', params, {stdio: 'inherit'});
}

function checksum(str, algorithm, encoding) {
	return crypto
		.createHash(algorithm || 'md5')
		.update(str, 'utf8')
		.digest(encoding || 'hex');
}

function resetConfig() {
	fs.unlinkSync(`${SETTINGS_FILE_NAME}.json`);
}

function getChecksumOfGradleFiles(path) {
	return fileHound.create()
		.paths(path)
		.ext('gradle')
		.ignoreHiddenDirectories()
		.depth(3)
		.find()
		.then(files => {
			let mix = '';
			files.forEach(file => {
				mix += md5File.sync(file);
			});
			return checksum(mix);
		});
}

function keysrt(key) {
	return function (a, b) {
		if (a[key] > b[key]) {
			return 1;
		}
		if (a[key] < b[key]) {
			return -1;
		}
		return 0;
	};
}

function filterTasks(input, tasks, flags) {
	const filters = {
		name: task => input ? task.name.toLowerCase().includes(input.toLowerCase()) : true,
		description: task => input ? task.description.toLowerCase().includes(input.toLowerCase()) : true
	};

	return tasks
		.filter(flags.description ? filters.description : filters.name)
		.map(task => {
			const lineLength = process.stdout.columns || 80;
			const margins = commandLineMargins + task.description.toString().length;
			const length = lineLength - margins;
			const name = cliTruncate(task.name, length, {position: 'middle'});
			return {
				name: `${name} ${chalk.dim(task.description)}`,
				value: task.name
			};
		});
}
