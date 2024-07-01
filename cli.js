#!/usr/bin/env node
"use strict";

import fs from "fs";
import { spawn, exec } from "child_process";
import crypto from "crypto";
import chalk from "chalk";
import inquirer from "inquirer";
import escExit from "esc-exit";
import cliTruncate from "cli-truncate";
import meow from "meow";
import fileHound from "filehound";
import md5File from "md5-file";
import ora from "ora";
import updateNotifier from "update-notifier";
import hasFlag from "has-flag";
import { createRequire } from "module";

// Since `pkg` is not an ES module, use `createRequire` to import it
const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const log = console.log;

updateNotifier({ pkg }).notify();

const SETTINGS_FILE_NAME = "build/tasks.cache";

const cli = meow(
	`
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
`,
	{
		importMeta: import.meta,
		alias: {
			f: "force",
			o: "offline",
			v: "version",
		},
		boolean: ["force", "offline", "version"],
	}
);

// Your code here
log(cli.input, cli.flags);

const commandLineMargins = 4;

// =======================
// Main Code

const force = hasFlag("-f") || hasFlag("--force");
const offline = hasFlag("-o") || hasFlag("--offline");

if (!isValidGradleProject()) {
	console.log(chalk.red.bgBlack("This is not a valid gradle project"));
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
		.then((tasks) => listAvailableTasks(tasks, flags))
		.catch((err) => {
			console.log(chalk.red(err));
			process.exit();
		});
}

function isValidGradleProject() {
	return fs.existsSync("build.gradle");
}

function parseGradleTasks(stdout) {
	const lines = stdout.split("\n");
	let collectTasks = false;
	const tasks = lines.reduce((acc, line, i) => {
		if (line.startsWith("All tasks runnable from root project")) {
			collectTasks = true;
			return acc;
		}
		if (
			!collectTasks ||
			/^\s*$/.test(line) ||
			line.startsWith("---") ||
			lines[i + 1]?.startsWith("---")
		) {
			return acc;
		}
		acc.push(line);
		return acc;
	}, []);

	// Add common missing items directly
	const commonTasks = [
		"javadoc - Generates Javadoc API documentation for the main source code",
		"test - Runs the unit tests.",
		"check - Runs all checks",
		"dependencies - Displays all dependencies declared in root project ",
		"wrapper - Generates Gradle wrapper files.",
		"assemble - Assembles the outputs of this project.",
		"build - Assembles and tests this project.",
		"buildDependents - Assembles and tests this project and all projects that depend on it.",
		"buildNeeded - Assembles and tests this project and all projects it depends on.",
		"classes - Assembles main classes.",
		"clean - Deletes the build directory.",
		"jar - Assembles a jar archive containing the main classes.",
		"testClasses - Assembles test classes.",
	];

	// Combine and map to desired structure
	return [...tasks, ...commonTasks].map((task) => {
		const [name, description = ""] = task.split(" - ");
		return { name, description };
	});
}

function isCacheDirty(previousChecksum, previousGradlrVersion) {
	return getChecksumOfGradleFiles(".").then(
		(sum) => previousChecksum !== sum || previousGradlrVersion !== pkg.version
	);
}

function getTasksFromCache() {
	return new Promise((resolve, reject) => {
		const spinner = ora({
			color: "yellow",
			text: "Parsing gradle tasks...",
		}).start();

		exec("./gradlew tasks --console=plain", (error, stdout) => {
			spinner.stop();
			const items = parseGradleTasks(stdout);
			if (items.length === 0) {
				reject(error);
			} else {
				getChecksumOfGradleFiles(".").then((sum) => {
					saveSettings({
						timestamp: Date.now(),
						generatedWith: "https://github.com/cesarferreira/gradlr",
						checksum: sum,
						gradlrVersion: pkg.version,
						payload: items.sort(keysrt("name")),
					}).then((data) => resolve(data.payload));
				});
			}
		});
	});
}

function getTasks() {
	return new Promise((resolve, reject) => {
		readSettings()
			.then((settings) => {
				isCacheDirty(settings.checksum, settings.gradlrVersion).then(
					(isItDirty) => {
						if (isItDirty) {
							resetConfig();
							getTasksFromCache()
								.then((data) => resolve(data))
								.catch((err) => reject(err));
						} else {
							resolve(settings.payload);
						}
					}
				);
			})
			.catch(() => {
				getTasksFromCache()
					.then((data) => resolve(data))
					.catch((err) => reject(err));
			});
	});
}

function saveSettings(data) {
	return new Promise((resolve, reject) => {
		fs.writeFile(
			`${SETTINGS_FILE_NAME}.json`,
			JSON.stringify(data, null, 2),
			"utf-8",
			(err) => {
				if (err) {
					reject(err);
				} else {
					resolve(data);
				}
			}
		);
	});
}

function readSettings() {
	return new Promise((resolve, reject) => {
		fs.readFile(`${SETTINGS_FILE_NAME}.json`, "utf-8", (err, data) => {
			if (err) {
				reject(err);
			} else {
				promisedParseJSON(data)
					.then((data) => resolve(data))
					.catch((err) => reject(err));
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
	inquirer.registerPrompt(
		"autocomplete",
		require("inquirer-autocomplete-prompt")
	);
	return inquirer
		.prompt([
			{
				name: "target",
				message: "Available tasks:",
				type: "autocomplete",
				pageSize: 10,
				source: (answers, input) =>
					Promise.resolve().then(() => filterTasks(input, processes, flags)),
			},
		])
		.then((answer) => execute(answer));
}

function execute(task) {
	const params = [task.target];
	if (offline) {
		params.push("--offline");
	}
	log(`Running: ${chalk.green.bold(params.join(" "))}\n`);
	spawn("./gradlew", params, { stdio: "inherit" });
}

function checksum(str, algorithm, encoding) {
	return crypto
		.createHash(algorithm || "md5")
		.update(str, "utf8")
		.digest(encoding || "hex");
}

function resetConfig() {
	const filePath = `${SETTINGS_FILE_NAME}.json`;
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	} else {
		console.log(`File ${filePath} does not exist.`);
	}
}

function getChecksumOfGradleFiles(path) {
	return fileHound
		.create()
		.paths(path)
		.ext("gradle")
		.ignoreHiddenDirectories()
		.depth(3)
		.find()
		.then((files) => {
			let mix = "";
			files.forEach((file) => {
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
		name: (task) =>
			input ? task.name.toLowerCase().includes(input.toLowerCase()) : true,
		description: (task) =>
			input
				? task.description.toLowerCase().includes(input.toLowerCase())
				: true,
	};

	return tasks
		.filter(flags.description ? filters.description : filters.name)
		.map((task) => {
			const lineLength = process.stdout.columns || 80;
			const margins = commandLineMargins + task.description.toString().length;
			const length = lineLength - margins;
			const name = cliTruncate(task.name, length, { position: "middle" });
			return {
				name: `${name} ${chalk.dim(task.description)}`,
				value: task.name,
			};
		});
}
