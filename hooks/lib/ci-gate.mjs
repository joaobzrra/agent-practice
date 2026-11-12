/**
 * Full-CI gate. BLOCKS a commit when the repository's full CI command fails.
 *
 * Why: a stale test slipped through because only individual gates were run
 * before a commit instead of the full CI command. The rule "run the full suite"
 * existed in prose; this makes it a check.
 *
 * Opt-in per repository. The full CI command comes from, in order:
 *   1. `<repo>/.claude/ci-command` — first non-blank, non-# line.
 *   2. `ci-commands.json` in the hooks folder — { "<repo root>": "<command>" }.
 *      Central, so opting a repo in never adds a file to that repo (useful for
 *      a repo that belongs to someone else or is shared with a team).
 * A repo in neither is never slowed down. The command runs from the repo root.
 *
 * Skipped when every file in the commit is documentation (.md / .txt), because
 * handoffs and ledger updates are committed often and cannot break CI.
 *
 * The command runs against the WORKING TREE, not the staged snapshot. With a
 * partially staged commit, CI also sees the unstaged edits. That is the
 * accepted limit of a hook that must stay simple.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Overridable so the tests never touch the real map.
const MAP_FILE =
  process.env.CI_GATE_MAP || join(dirname(fileURLToPath(import.meta.url)), '..', 'ci-commands.json');

const normPath = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Must stay below the hook timeout in settings.json. A hook that times out does
// not block, so a CI run longer than the hook timeout would wave the commit through.
export const CI_TIMEOUT_MS = 540_000;

const DOC_ONLY = /\.(md|txt)$/i;

export function readCiCommand(repo) {
  const file = join(repo, '.claude', 'ci-command');
  if (existsSync(file)) {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith('#'));
    return line || null;
  }
  if (!existsSync(MAP_FILE)) return null;
  let map;
  try {
    map = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
  } catch (e) {
    // A broken map must be loud, not a silent opt-out of every repo.
    throw new Error(`ci-commands.json is not valid JSON: ${e.message}`);
  }
  const want = normPath(repo);
  for (const [key, cmd] of Object.entries(map)) {
    if (!key.startsWith('_') && normPath(key) === want && typeof cmd === 'string' && cmd.trim()) {
      return cmd.trim();
    }
  }
  return null;
}

function committedFiles(command, repo) {
  const git = (args) => {
    try {
      return execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return '';
    }
  };
  // Same rule as leak-scan: `-a` / `-am` stages tracked edits at commit time.
  const stagesTracked = /\s-[a-zA-Z]*a[a-zA-Z]*\b|--all\b/.test(command);
  let out = git(['diff', '--cached', '--name-only']);
  if (stagesTracked) out += '\n' + git(['diff', '--name-only']);
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
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
    // quietly switch the gate off for every repo in the map.
    return `Blocked: ${e.message}\nFix ${MAP_FILE} (it must be valid JSON), then commit again.\n`;
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
    `do not remove the repo's CI entry to get the commit through — that is the ` +
    `operator's call.\n\n` +
    `Last 40 lines of output:\n${tail}\n`
  );
}
