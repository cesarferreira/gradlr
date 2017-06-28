#!/usr/bin/env node
'use strict';
const meow = require('meow');
const chalk = require('chalk');
const inquirer = require('inquirer');
const escExit = require('esc-exit');
const cliTruncate = require('cli-truncate');
const fs = require('fs');
var path = require('path'); 
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var child;

const SETTINGS_FILE_NAME = '.tasks.cache'

const cli = meow(`
	Usage
		$ gradlr [<pid|name> ...]

	Options
		-f, --force    Force to re-index the tasks

	Examples
		$ gradlr
		$ gradlr -f
		$ gradlr -v

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
	var taskPromise = new Promise(
		function (resolve, reject) {
			readSettings()
					.then(success => resolve(success))
					.catch(function (error) {
						console.log('Parsing tasks...');
						child = exec("gradle -q tasks --all", function (error, stdout, stderr) {
							var items = stdout.split('\n');
							var array = [];
							items.forEach(item => {
								if (item.substring(0, 15).includes(':')) {
									var separation = item.split(' - ');
									var name = separation[0];
									var description = separation.length == 2 ? separation[1] : "";
									array.push({ name , description });
								}
							})

							// save 
							writeSettings(array)
								.then(data => resolve(data));
						});
					});
		}
	);
	return taskPromise;
}

function writeSettings(data) {
	return new Promise(function(resolve, reject) {
		fs.writeFile(`${SETTINGS_FILE_NAME}.json`, JSON.stringify(data), 'utf-8', function(err) {
			if (err) reject(err);
			else resolve(data);
		});
	});
}

function readSettings() {
	return new Promise(function(resolve, reject) {
		fs.readFile(`${SETTINGS_FILE_NAME}.json`, 'utf-8', function(err, data) {
			if (err) {
				reject(err);
			} else {
				promisedParseJSON(data)
					.then(data =>resolve(data))
				  	.catch(error => reject(error));
			}
		});
	});
}

function promisedParseJSON(json) {
    return new Promise((resolve, reject) => {
        try {
            resolve(JSON.parse(json))
        } catch (e) {
            reject(e)
        }
    })
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

function isValidGradleProject() {
	var path = process.cwd();
	// todo ver se tem 'build.gradle' aqui, se nao tiver cancela
	
}

function areOfflineTasksAvailable() {
	if (fs.existsSync(path)) {
		// Do something
	}
}

function execute(task) {
	console.log(task.target);
	spawn('./gradlew', [task.target], { stdio: 'inherit' });
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
	fkill(cli.input, cli.flags); //.catch(() => handleMainError(cli.input));
}
