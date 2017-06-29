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
const FileHound = require('filehound');
const md5File = require('md5-file');
const ora = require('ora');
const updateNotifier = require('update-notifier');
const pkg = require('./package.json');

updateNotifier({pkg}).notify();

const SETTINGS_FILE_NAME = '.tasks.cache';

const cli = meow(`
	Usage
		$ gradlr

	Options
		-f, --force    Force to re-index the tasks

	Examples
		$ gradlr
		$ gradlr --force

	Run without arguments to use the interactive interface.
`, {
	alias: {
		f: 'force'
	},
	boolean: [
		'force'
	]
});

const commandLineMargins = 4;

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
	lines.forEach(item => {
		if (item.substring(0, 15).includes(':')) {
			const separation = item.split(' - ');
			const name = separation[0];
			const description = separation.length === 2 ? separation[1] : '';
			items.push({name, description});
		}
	});
	return items;
}

function isGradleDirty(previousChecksum) {
	return getChecksumOfGradleFiles('.').then(checksum => previousChecksum !== checksum);
}

function generateTasksJSON() {
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
					.then(checksum => {
						saveSettings({
							timestamp: Date.now(),
							generatedWith: 'https://github.com/cesarferreira/gradlr',
							checksum,
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
					isGradleDirty(settings.checksum)
						.then(isItDirty => {
							if (isItDirty) {
								resetConfig();
								generateTasksJSON()
									.then(data => resolve(data))
									.catch(err => reject(err));
							} else {
								resolve(settings.payload);
							}
						});
				})
				.catch(() => {
					generateTasksJSON()
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
		pageSize: 15,
		source: (answers, input) => Promise.resolve().then(() => filterTasks(input, processes, flags))
	}])
	.then(answer => execute(answer));
}

function execute(task) {
	console.log(`Running: ${chalk.green(task.target)}\n`);
	spawn('./gradlew', [task.target], {stdio: 'inherit'});
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
	return FileHound.create()
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

// Main Code

if (!isValidGradleProject()) {
	console.log(chalk.red.bgBlack('This is not a valid gradle project'));
	process.exit();
}

if (cli.input.length === 0) {
	init(cli.flags);
} else {
	console.log(cli.input);
	console.log(cli.flags);
}
