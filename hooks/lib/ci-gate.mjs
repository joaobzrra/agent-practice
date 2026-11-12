/**
 * Full-CI gate. BLOCKS a commit when the repository's full CI command fails.
 *
 * Why: a stale test slipped through because only individual gates were run
 * before a commit instead of the full CI command. The rule "run the full suite"
 * existed in prose; this makes it a check.
 *
 * Opt-in per repository. The full CI command comes from, in order:
 *   1. `<repo>/.claude/ci-command` — first non-blank, non-# line. Honoured only
 *      while its content matches the hash recorded for that checkout in
 *      `ci-command-approvals.json` in the hooks folder (see below).
 *   2. `ci-commands.json` in the hooks folder — { "<repo root>": "<command>" }.
 *      Central, so opting a repo in never adds a file to that repo (useful for
 *      a repo that belongs to someone else or is shared with a team).
 * A repo in neither is never slowed down. The command runs from the repo root.
 *
 * Why the per-repo file is recorded: it lives inside the repository, where the
 * agent being gated works. Left unchecked, an agent blocked by a failing suite
 * could write `exit 0` into that file and commit. The record lives in the
 * hooks folder, outside the repo, and the rule is trust on first use, block on
 * change:
 *   - a file in a checkout the central map does NOT list is recorded the first
 *     time the gate sees it (a new worktree gets its own command, no ceremony);
 *   - a file in a checkout the central map DOES list replaces an existing gate,
 *     so it blocks until `approve-ci-command.mjs` records it;
 *   - a recorded file whose content changed blocks until it is approved again;
 *   - a recorded file that has gone missing blocks until it is revoked;
 *   - a recorded file with no command line falls through to the central map.
 * Nothing an agent does to that file at commit time can make the gate weaker.
 *
 * Skipped when every file in the commit is documentation (.md / .txt), because
 * handoffs and ledger updates are committed often and cannot break CI.
 *
 * The command runs against the WORKING TREE, not the staged snapshot. With a
 * partially staged commit, CI also sees the unstaged edits. That is the
 * accepted limit of a hook that must stay simple; `advisory()` below says so
 * out loud when it happens.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Overridable so the tests never touch the real files.
const MAP_FILE = process.env.CI_GATE_MAP || join(HOOKS_DIR, 'ci-commands.json');
export const APPROVALS_FILE =
  process.env.CI_GATE_APPROVALS || join(HOOKS_DIR, 'ci-command-approvals.json');

export const normPath = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Line endings are normalised so a checkout that rewrites them does not look
// like a change to the command.
export const fileHash = (text) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

// Must stay below the hook timeout set where the hook is registered. A hook
// that times out does not block, so a CI run longer than the hook timeout
// would wave the commit through.
export const CI_TIMEOUT_MS = 540_000;

const DOC_ONLY = /\.(md|txt)$/i;
// Same rule as leak-scan: `-a` / `-am` stages tracked edits at commit time.
const STAGES_TRACKED = /\s-[a-zA-Z]*a[a-zA-Z]*\b|--all\b/;

function readJson(file, name) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    // A broken file must be loud, not a silent opt-out of every repo.
    throw new Error(
      `${name} is not valid JSON: ${e.message}\nFix ${file} (it must be valid JSON), then commit again.`,
    );
  }
}

function lookup(map, repo) {
  const want = normPath(repo);
  for (const [key, value] of Object.entries(map)) {
    if (!key.startsWith('_') && normPath(key) === want && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

const USERS_CALL =
  `Changing what gates a commit is the user's call, not the agent's. Do not ` +
  `edit, delete, restore or approve this file to get a commit through; tell ` +
  `the user and wait.`;

export function readCiCommand(repo) {
  const file = join(repo, '.claude', 'ci-command');
  const approvals = readJson(APPROVALS_FILE, 'ci-command-approvals.json');
  const recorded = lookup(approvals, repo);
  const central = lookup(readJson(MAP_FILE, 'ci-commands.json'), repo);
  const approveCmd = `node "${join(HOOKS_DIR, 'approve-ci-command.mjs')}" "${repo}"`;
  const forTheUser = `For the user: approve the file as it is now with\n  ${approveCmd}`;

  if (!existsSync(file)) {
    if (recorded) {
      throw new Error(
        `${file} was recorded as this checkout's CI command and is now missing.\n\n` +
          `${USERS_CALL}\n\nFor the user: restore the file, or drop the record with\n` +
          `  ${approveCmd} --revoke`,
      );
    }
    return central;
  }

  const text = readFileSync(file, 'utf8');
  const hash = fileHash(text);
  if (recorded && recorded !== hash) {
    throw new Error(
      `${file} has changed since it was recorded, so it is not trusted to ` +
        `choose this checkout's CI command.\n\n${USERS_CALL}\n\n${forTheUser}`,
    );
  }
  if (!recorded) {
    if (central) {
      throw new Error(
        `${file} is new, and this repository is already gated by ` +
          `ci-commands.json. A file that replaces an existing gate has to be ` +
          `approved.\n\n${USERS_CALL}\n\n${forTheUser}\n` +
          `or delete it to keep the ci-commands.json entry.`,
      );
    }
    // First sight, in a checkout nothing else gates: record it. From now on a
    // change to this file is a change to the gate, and blocks.
    try {
      writeFileSync(APPROVALS_FILE, JSON.stringify({ ...approvals, [normPath(repo)]: hash }, null, 2) + '\n');
    } catch (e) {
      throw new Error(`could not record ${file} in ${APPROVALS_FILE}: ${e.message}`);
    }
  }

  const line = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#'));
  // Recorded, but it names no command: the central map decides.
  return line || central;
}

function names(repo, args) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function committedFiles(command, repo) {
  const out = names(repo, ['diff', '--cached', '--name-only']);
  if (STAGES_TRACKED.test(command)) out.push(...names(repo, ['diff', '--name-only']));
  return out;
}

/**
 * @param command the shell command line being run
 * @param repo    the already-resolved repository root
 * @returns null to allow, or the block reason
 */
export function check(command, repo) {
  let ci;
  try {
    ci = readCiCommand(repo);
  } catch (e) {
    // Blocking every commit is loud and a one-line fix. Allowing them would
    // quietly switch the gate off.
    return `Blocked: ${e.message}\n`;
  }
  if (!ci) return null;

  const files = committedFiles(command, repo);
  if (files.length > 0 && files.every((f) => DOC_ONLY.test(f))) return null;

  const r = spawnSync(ci, {
    cwd: repo,
    shell: true,
    encoding: 'utf8',
    timeout: CI_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.status === 0) return null;

  const tail = `${r.stdout || ''}${r.stderr || ''}`.trimEnd().split(/\r?\n/).slice(-40).join('\n');
  const why = r.error?.code === 'ETIMEDOUT'
    ? `did not finish within ${CI_TIMEOUT_MS / 1000}s`
    : `exited with code ${r.status}`;

  return (
    `Blocked: the full CI \`${ci}\` (from .claude/ci-command or ` +
    `ci-commands.json in the hooks folder) ${why}.\n\n` +
    `Fix the failure and commit again. Do not run individual gates instead, and ` +
    `do not remove or rewrite the repo's CI entry to get the commit through — ` +
    `that is the operator's call.\n\n` +
    `Last 40 lines of output:\n${tail}\n`
  );
}

/**
 * Called only after every check allowed the commit. CI ran on the working
 * tree, so a passing run says nothing about files the commit will not contain.
 * When such files exist, say so. Advisory: it never blocks.
 *
 * @returns null, or a note for the agent
 */
export function advisory(command, repo) {
  let ci;
  try {
    ci = readCiCommand(repo);
  } catch {
    return null;
  }
  if (!ci) return null;

  const staged = names(repo, ['diff', '--cached', '--name-only']);
  if (staged.length === 0 || staged.every((f) => DOC_ONLY.test(f))) return null; // CI did not run

  const isCode = (f) => !DOC_ONLY.test(f) && f !== '.claude/ci-command';
  const unstaged = STAGES_TRACKED.test(command)
    ? [] // -a commits every tracked edit
    : names(repo, ['diff', '--name-only']).filter(isCode);
  const untracked = names(repo, ['ls-files', '--others', '--exclude-standard']).filter(isCode);
  if (unstaged.length === 0 && untracked.length === 0) return null;

  const list = (files) => {
    const shown = files.slice(0, 8).map((f) => `  ${f}`).join('\n');
    return files.length > 8 ? `${shown}\n  ... and ${files.length - 8} more` : shown;
  };
  let note =
    `CI gate: the full CI passed, but it ran against the working tree, not ` +
    `against what this commit contains.\n`;
  if (unstaged.length) note += `\nTracked files with edits this commit leaves out:\n${list(unstaged)}\n`;
  if (untracked.length) note += `\nUntracked files this commit leaves out:\n${list(untracked)}\n`;
  note +=
    `\nIf the committed code needs any of them, CI passed on a state that is ` +
    `not being committed. Stage them, or confirm the commit stands without them.`;
  return note;
}
