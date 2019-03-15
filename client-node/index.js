#!/usr/bin/env node

const process = require("process");
const fs = require("fs");
const util = require("util");
const program = require("commander");

/**
 * @typedef {Object} Args
 * @property {string} input The input filename
 * @property {string} output The output filename
 */

/**
 * @returns {Args}
 */
function parseCommandLine() {
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
async function loadInputFile(filename) {
    const data = await util.promisify(fs.readFile)(filename, "utf8");
    try {
        const parsed = JSON.parse(data);
        return parsed;
    } catch (exc) {
        console.error(`Failed to parse ${filename} as JSON`);
        throw exc;
    }
}

/**
 * @param {string} filename
 * @param {any} values
 */
async function saveOutputFile(filename, values) {
    const data = JSON.stringify(values, null, 4) + "\n";
    if (filename === "/dev/stdout") {
        process.stdout.write(data);
        return;
    }
    return util.promisify(fs.writeFile)(filename, data, "utf8");
}

function getQueryLimit() {
    const limitVar = "KAT_QUERY_LIMIT";
    const defaultQueryLimit = 25;
    if (!process.env.hasOwnProperty(limitVar)) {
        return defaultQueryLimit;
    }
    const limitValue = process.env[limitVar];
    const queryLimit = parseInt(limitValue);
    if (isNaN(queryLimit)) {
        console.error(`Failed to parse ${limitVar} value ${limitValue}`);
        console.error(`Using default query limit ${defaultQueryLimit}`);
        return defaultQueryLimit;
    }
    return queryLimit;
}

async function main() {
    const args = parseCommandLine();
    console.error(`Processing from ${args.input} to ${args.output}`);

    const specs = await loadInputFile(args.input);

    // Limit parallelism
    const queryLimit = getQueryLimit();
    // FIXME: grab a semaphore and do something useful...

    // Do some work and save the results in specs[...].result
    for (const query of specs) {
        if (query.hasOwnProperty("result")) {
            throw Error(`Found pre-existing results in ${query}`);
        }
        query["result"] = {};
    }

    // Write out specs; each object should have a .result object.
    await saveOutputFile(args.output, specs);

    console.error("Done.")
}

main().catch(reason => {
    console.error(`Failed: ${reason}`);
    process.exitCode = 1;
})
