#!/usr/bin/env node

const process = require("process");
const fs = require("fs");
const program = require("commander");

/**
 * @typedef {Object} Args
 * @property {string} input The input filename
 * @property {string} output The output filename
 */

/**
 * @returns {Args}
 */
function parseCommandLine () {
    // Work around Golang's Posix-hostile single-dash long arguments by replacing
    // "-longArg" with "--longArg" for known arguments.
    const mungedArgs = process.argv.map(element => {
        if ((element.startsWith("-input") || element.startsWith("-output"))) {
            return "-" + element;
        }
        return element;
    });

    // Parse the (munged) command line
    program
        .usage("")
        .option("--input <path>", "Input filename", "/dev/stdin")
        .option("--output <path>", "Output filename", "/dev/stdout")
        .parse(mungedArgs)
    if (program.args.length > 0) {
        program.help();
    }

    return { input: program.input, output: program.output };
}

/**
 * @param {string} filename
 * @returns {Array<Object>}
 */
async function loadInputFile (filename) {
    const dataPromise = new Promise((resolve, reject) => {
        fs.readFile(filename, "utf8", (err, data) => {
            if (err) reject(err);
            resolve(data);
        });
    })
    const data = await dataPromise;
    try {
        const parsed = JSON.parse(data);
        return parsed;
    } catch (exc) {
        console.error(`Failed to parse ${filename} as JSON`);
        throw exc;
    }
}

async function main () {
    const args = parseCommandLine();
    console.error(`Processing from ${args.input} to ${args.output}`);

    const specs = await loadInputFile(args.input);
    for (const obj of specs) {
        console.dir(obj);
    }
}

main().catch(reason => {
    console.error(`Failed: ${reason}`);
    process.exitCode = 1;
})
