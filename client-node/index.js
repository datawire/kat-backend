#!/usr/bin/env node

const process = require("process");
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

args = parseCommandLine()
console.error(`Processing from ${args.input} to ${args.output}`);
