#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { resolveMany } from '../src/index.js';

const HELP = `Usage: google-news-url-resolver [options] <url...>
       cat urls.txt | google-news-url-resolver [options]

Resolve news.google.com article URLs to publisher URLs.

Options:
  --json              Print one JSON object per line
  --hl <lang>         Interface language (default en-US)
  --gl <country>      Country (default US)
  --ceid <edition>    Edition (default <gl>:<lang>)
  --concurrency <n>   Parallel resolutions (default 2)
  --delay <ms>        Pause per worker between resolutions (default 250)
  --timeout <ms>      Per-request timeout (default 30000)
  -h, --help          Show help`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      hl: { type: 'string' },
      gl: { type: 'string' },
      ceid: { type: 'string' },
      concurrency: { type: 'string' },
      delay: { type: 'string' },
      timeout: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (error) {
  console.error(`${error.message}\n\n${HELP}`);
  process.exit(2);
}
const { values, positionals } = parsed;

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

let inputs = positionals;
if (inputs.length === 0 && !process.stdin.isTTY) {
  inputs = [];
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim()) inputs.push(line.trim());
  }
}
if (inputs.length === 0) {
  console.error(HELP);
  process.exit(2);
}

const num = value => (value === undefined ? undefined : Number(value));
const results = await resolveMany(inputs, {
  hl: values.hl,
  gl: values.gl,
  ceid: values.ceid,
  concurrency: num(values.concurrency),
  delayMs: num(values.delay),
  timeoutMs: num(values.timeout),
});

for (const result of results) {
  if (values.json) {
    console.log(JSON.stringify(result.error
      ? { input: result.input, error: { code: result.error.code ?? 'ERROR', message: result.error.message } }
      : result));
  } else if (result.error) {
    console.error(`${result.input}\t${result.error.code ?? 'ERROR'}: ${result.error.message}`);
  } else {
    console.log(result.url);
  }
}
if (results.some(result => result.error)) process.exitCode = 1;
