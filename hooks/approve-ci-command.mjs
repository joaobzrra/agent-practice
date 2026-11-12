#!/usr/bin/env node
/**
 * Approve (or revoke) a repository's `.claude/ci-command` for the full-CI gate.
 *
 *   node approve-ci-command.mjs <repo root>            approve the file as it is now
 *   node approve-ci-command.mjs <repo root> --revoke   drop the approval
 *
 * The gate honours a per-repo command file only while its content matches the
 * hash recorded here. The record lives in the hooks folder, outside the
 * repository, so the agent being gated cannot change what gates it by editing
 * a file in its own working tree.
 *
 * A file in a checkout that `ci-commands.json` does not list is recorded by
 * the gate itself the first time it is seen. This script is for the cases the
 * gate blocks on: a file that changed, a file that replaces a central entry,
 * and a recorded file that was removed on purpose.
 *
 * This is for the person who owns the machine. An agent that runs it to get a
 * commit through is bypassing the gate.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APPROVALS_FILE, fileHash, normPath } from './lib/ci-gate.mjs';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node approve-ci-command.mjs <repo root> [--revoke]');
  process.exit(2);
}

const repo = resolve(target);
const key = normPath(repo);
let approvals = {};
if (existsSync(APPROVALS_FILE)) {
  try {
    approvals = JSON.parse(readFileSync(APPROVALS_FILE, 'utf8'));
  } catch (e) {
    console.error(`${APPROVALS_FILE} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}
for (const existing of Object.keys(approvals)) {
  if (!existing.startsWith('_') && normPath(existing) === key) delete approvals[existing];
}

if (revoke) {
  writeFileSync(APPROVALS_FILE, JSON.stringify(approvals, null, 2) + '\n');
  console.log(`Revoked: ${repo} no longer has an approved .claude/ci-command.`);
  process.exit(0);
}

const file = join(repo, '.claude', 'ci-command');
if (!existsSync(file)) {
  console.error(`Nothing to approve: ${file} does not exist.`);
  process.exit(1);
}
const text = readFileSync(file, 'utf8');
const command = text
  .split(/\r?\n/)
  .map((s) => s.trim())
  .find((s) => s && !s.startsWith('#'));
approvals[key] = fileHash(text);
writeFileSync(APPROVALS_FILE, JSON.stringify(approvals, null, 2) + '\n');
console.log(`Approved ${file}`);
console.log(command ? `Gate command: ${command}` : 'It names no command, so ci-commands.json decides.');
