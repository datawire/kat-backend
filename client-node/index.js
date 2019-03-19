#!/usr/bin/env node

// Node
const fs = require("fs");
const process = require("process");
const util = require("util");

// Third-party from npmjs.org
const program = require("commander");
global.XMLHttpRequest = require("xhr2");

// Project
const { EchoRequest } = require("./echo_pb.js");
const { EchoServiceClient } = require("./echo_grpc_web_pb.js");

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
    const mungedArgs = process.argv.map((element) => {
        if ((element.startsWith("-input") || element.startsWith("-output"))) {
            return `-${element}`;
        }
        return element;
    });

    // Parse the (munged) command line
    program
        .usage("")
        .option("--input <path>", "Input filename", "/dev/stdin")
        .option("--output <path>", "Output filename", "/dev/stdout")
        .parse(mungedArgs);
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
    // Consider using json-stable-stringify to make the JSON output closer to
    // what the Go client generates (by sorting object keys).
    const data = JSON.stringify(values, null, 2);
    if (filename === "/dev/stdout") {
        process.stdout.write(data);
        return;
    }
    await util.promisify(fs.writeFile)(filename, data, "utf8");
}

function getQueryLimit() {
    const limitVar = "KAT_QUERY_LIMIT";
    const defaultQueryLimit = 25;
    if (!process.env.hasOwnProperty(limitVar)) {
        return defaultQueryLimit;
    }
    const limitValue = process.env[limitVar];
    const queryLimit = parseInt(limitValue, 10);
    if (Number.isNaN(queryLimit)) {
        console.error(`Failed to parse ${limitVar} value ${limitValue}`);
        console.error(`Using default query limit ${defaultQueryLimit}`);
        return defaultQueryLimit;
    }
    return queryLimit;
}

function queryIsWebsocket(query) {
    return query.url.startsWith("ws:");
}

/**
 * @typedef {Object} Header
 * @property {string} key The header as spelled in the input
 * @property {string[]} values The associated values
 */

/**
* @param {Object} headers
* @param {string} desired
* @returns {Header}
*/
function getHeader(headers, desired) {
    const compareKey = desired.toLowerCase();
    const key = Object.keys(headers).find(hkey => hkey.toLowerCase() === compareKey);
    if (key) {
        const values = headers[key];
        if (Array.isArray(values)) {
            // Already an array; return a copy
            return { key, values: values.slice() };
        }
        // Presumably a string; return as a new array
        return { key, values: [values] };
    }
    return { key, values: [] };
}

function queryIsGRPC(query) {
    const agrpc = "application/grpc"; // maybe "application/grpc-web-text"
    const ctValues = getHeader(query.headers, "content-type").values;
    const idx = ctValues.findIndex(value => value.toLowerCase() === agrpc);
    return idx !== -1; // not found yields -1
}

async function executeWSQuery(query) {
    query.result.unsupported = "Websocket queries are not supported.";
}

async function executeHTTPQuery(query) {
    query.result.unsupported = "HTTP(S) queries are not supported.";
}

async function executeGRPCQuery(query) {
    const url = new URL(query.url);
    const requiredPath = "/echo.EchoService/Echo";
    if (url.pathname !== requiredPath) {
        query.result.error = `GRPC path ${url.pathname} is not ${requiredPath}`;
        return;
    }
    const echoService = new EchoServiceClient(url.origin, null, null);
    const request = new EchoRequest();

    // Copy original headers, then remove Content-Type: application/grpc, as
    // that is incorrect. The grpc-web stuff will insert the correct header
    // (Content-Type: application/grpc-web-text) on its own.
    const headers = JSON.parse(JSON.stringify(query.headers));
    const ctHeader = getHeader(headers, "content-type");
    const newValue = ctHeader.values.filter(value => value.toLowerCase() !== "application/grpc");
    if (newValue.length === 0) {
        delete headers[ctHeader.key];
    } else {
        headers[ctHeader.key] = newValue;
    }

    const echoPromise = new Promise((resolve, reject) => {
        echoService.echo(request, headers, (err, response) => {
            if (err) reject(err); else resolve(response);
        });
    });
    try {
        const response = await echoPromise;
        const resHeadersMap = response.getResponse().getHeadersMap();
        const resHeadersObj = {};
        resHeadersMap.forEach((value, key) => {
            if (resHeadersObj.hasOwnProperty(key)) {
                resHeadersObj[key].push(value);
            } else {
                resHeadersObj[key] = [value];
            }
        });
        query.result.headers = resHeadersObj;

        // query.result.status = status;  FIXME
    } catch (err) {
        query.result.error = `Request failed: [${err.code}] ${err.message}`;
    }
}

async function executeQuery(query, sem) {
    // Set up where the answer will be saved
    if (query.hasOwnProperty("result")) {
        throw Error(`Found pre-existing results in ${query}`);
    }
    query.result = {};

    // Limit parallelism
    await sem.acquire();

    /*
    const url = new URL(query.url);
    const options = {
        agent: false,  // new agent per request to avoid connection pooling
        headers: query.headers,
        method: query.method || "GET",
        timeout: 10 * 1000,
        // Maybe add options from tls.connect(...)
    }
    */

    // Execute the correct type of query
    if (queryIsWebsocket(query)) {
        await executeWSQuery(query);
    } else if (queryIsGRPC(query)) {
        await executeGRPCQuery(query);
    } else {
        await executeHTTPQuery(query);
    }

    await sem.release();
}

class FakeSemaphore {
    constructor(count) {
        this.count = count;
    }

    acquire() {
        return;
    }

    release() {
        return;
    }
}

async function main() {
    const args = parseCommandLine();
    console.error(`Processing from ${args.input} to ${args.output}`);

    const specs = await loadInputFile(args.input);

    // Limit parallelism
    const queryLimit = getQueryLimit();
    const sem = new FakeSemaphore(queryLimit); // FIXME: use a real semaphore

    // Launch queries async; a result property is added to each query object.
    const tasks = specs.map(query => executeQuery(query, sem));

    // Wait for queries to finish
    await Promise.all(tasks);

    // Write out specs; each object should have a .result object.
    await saveOutputFile(args.output, specs);
    console.error("Done.");
}

main();
// main().catch(reason => {
//     console.error(`Failed: ${reason}`);
//     process.exitCode = 1;
// })
