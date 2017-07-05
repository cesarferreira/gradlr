# Gradlr
> Fastest way to run your gradle tasks

<p align="center">
<img src="extras/action.gif" width="100%" />
</p>

[![Build Status](https://travis-ci.org/cesarferreira/gradlr.svg?branch=master)](https://travis-ci.org/cesarferreira/gradlr)
[![npm](https://img.shields.io/npm/dt/gradlr.svg)](https://www.npmjs.com/package/gradlr)
[![npm](https://img.shields.io/npm/v/gradlr.svg)](https://www.npmjs.com/package/gradlr)

## Install

```
$ npm install -g gradlr
```

## Usage

```
$ gradlr
	Usage
		$ gradlr

	Options
		-o, --offline  Execute the build without accessing network resources
		-f, --force    Force to re-index the tasks

	Examples
		$ gradlr
		$ gradlr --force
		$ gradlr --offline

```

## What happens under the hood?
First time you run `gradlr` it will cache the gradle tasks so the #2 time it'll load them instantantly.
How does it know it needs to re-index? When caching, this tool saves a checksum of the sum of checksums of all of the projects' gradle files (META!), so it knows when you changed something and re-indexes when needed.

## Should I commit the `.tasks.cache.json` file?
If you commit it, your colleagues will not have to index the tasks again.

### What terminal am I using?
Since a lot of people has been asking about my terminal setup, I made [this article](https://medium.com/@cesarmcferreira/what-terminal-am-i-using-cesar-ferreira-2e19e5f58fc5) explaining how to achieve it.

## Created by
[Cesar Ferreira](https://cesarferreira.com)

## License
YOLO © [Cesar Ferreira](https://cesarferreira.com)
