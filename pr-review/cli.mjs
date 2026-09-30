#!/usr/bin/env node
// Command dispatcher: node cli.mjs <command> --flag value ...
//
// Every command module owns its own console output and exit code, this
// file only resolves a command name to a function and calls it. Commands
// meant to be captured with shell redirection (checks, diff, routes, sweep,
// prepare) print pure JSON and nothing else to stdout; commands with an
// explicit --out flag (triage, capture, finish) write their own file and
// print a short human summary instead.

import { parseArgs } from './lib/args.mjs';

const COMMANDS = {
  prepare: async (args) => (await import('./prepare.mjs')).prepare(args),
  triage: async (args) => (await import('./triage.mjs')).triage(args),
  checkout: async (args) => (await import('./checkout.mjs')).checkout(args),
  dispose: async (args) => (await import('./checkout.mjs')).dispose(args),
  'refs-delete': async (args) => (await import('./checkout.mjs')).refsDelete(args),
  checks: async (args) => (await import('./checks.mjs')).checks(args),
  diff: async (args) => (await import('./diff.mjs')).diff(args),
  routes: async (args) => (await import('./affected-routes.mjs')).routes(args),
  sweep: async (args) => (await import('./affected-routes.mjs')).sweep(args),
  serve: async (args) => (await import('./servers.mjs')).serve(args),
  capture: async (args) => (await import('./capture.mjs')).capture(args),
  finish: async (args) => (await import('./finish.mjs')).finish(args),
};

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    console.error(`Usage: node cli.mjs <command> --flag value ...\n\nCommands: ${Object.keys(COMMANDS).join(', ')}\n\nSee README.md for the full spec of each command's flags and output.`);
    process.exitCode = command ? 0 : 1;
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command "${command}". Known commands: ${Object.keys(COMMANDS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(rest);

  try {
    await handler(args);
  } catch (err) {
    console.error(`${command} failed: ${err && err.stack ? err.stack : err}`);
    process.exitCode = process.exitCode || 1;
  }
}

main();
