#!/usr/bin/env node
'use strict';
const fs = require('fs');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
const chalk = require('chalk');
const inquirer = require('inquirer');
const escExit = require('esc-exit');
const cliTruncate = require('cli-truncate');
const meow = require('meow');

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
	return getTasks().then(procs => listAvailableTasks(procs, flags));
}

function getTasks() {
	const taskPromise = new Promise(resolve => {
		readSettings()
				.then(success => resolve(success))
				.catch(() => {
					console.log('Parsing tasks...');
					exec('gradle -q tasks --all', (error, stdout) => {
						const items = stdout.split('\n');
						const array = [];
						items.forEach(item => {
							if (item.substring(0, 15).includes(':')) {
								const separation = item.split(' - ');
								const name = separation[0];
								const description = separation.length === 2 ? separation[1] : '';
								array.push({name, description});
							}
						});
						// save
						saveSettings(array)
							.then(data => resolve(data));
					});
				});
	});
	return taskPromise;
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
	console.log(task.target);
	spawn('./gradlew', [task.target], {stdio: 'inherit'});
}

function filterTasks(input, tasks, flags) {
	const filters = {
		name: proc => input ? proc.name.toLowerCase().includes(input.toLowerCase()) : true,
		verbose: proc => input ? proc.description.toLowerCase().includes(input.toLowerCase()) : true
	};

	return tasks
		.filter(flags.verbose ? filters.verbose : filters.name)
		// ordenar por quem tem descricao em cima
		// nomes mais curtos em cima?
		.map(proc => {
			const lineLength = process.stdout.columns || 80;
			const margins = commandLineMargins + proc.description.toString().length;
			const length = lineLength - margins;
			const name = cliTruncate(proc.name, length, {position: 'middle'});
			return {
				name: `${name} ${chalk.dim(proc.description)}`,
				value: proc.name
			};
		});
}

if (cli.input.length === 0) {
	init(cli.flags);
} else {
	// cena(cli.input, cli.flags); //.catch(() => handleMainError(cli.input));
}
