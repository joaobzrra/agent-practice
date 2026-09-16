/**
 * Understand what a shell command line is actually going to do with git.
 *
 * Three things the guards need, and each is easy to get subtly wrong:
 *
 *   1. Is this a commit? A naive `/git .* commit/` matches `git log --grep
 *      commit`, and a naive `/git (?:-\S+ )*commit/` MISSES `git -C <path>
 *      commit` because `-C` takes a separate value. Tokenise instead.
 *
 *   2. Which repository? The hook payload's `cwd` is the SESSION working
 *      directory, not where the command runs. Claude routinely writes
 *      `cd /path/to/repo && git commit ...`, and the session cwd is often not
 *      a repo at all. Using the payload cwd blindly makes `git diff --cached`
 *      fail outside a repo — silently disabling the scan — or scan the wrong
 *      repository.
 *
 *   3. Which part of the line is the commit? A guard that judges the whole
 *      command blocks every long multi-line shell block that happens to end in
 *      a commit. Judge the segment, not the script.
 */

import { execFileSync } from 'node:child_process';

/** git options that consume the NEXT token as their value. */
const VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

const unquote = (p) => p.replace(/^["']|["']$/g, '').trim();
const tokenize = (s) => s.trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];

/** Split a command line into the pieces the shell runs in sequence. */
export const segments = (command) => command.split(/&&|\|\||[;|\n]/);

const looksLikeGit = (t) => t === 'git' || /[\\/]git(?:\.exe)?$/i.test(unquote(t ?? ''));

/** True when a segment of this command line runs `git commit`. */
export function isGitCommit(command) {
  for (const seg of segments(command)) {
    const toks = tokenize(seg);
    let i = toks.findIndex(looksLikeGit);
    if (i === -1) continue;
    i += 1;
    while (i < toks.length) {
      const t = toks[i];
      if (VALUE_OPTS.has(t)) {
        i += 2; // skip the option and its value
        continue;
      }
      if (t.startsWith('-')) {
        i += 1;
        continue;
      }
      if (t === 'commit') return true;
      break; // some other subcommand
    }
  }
  return false;
}

function toplevel(dir) {
  if (!dir) return null;
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The repository root this command will commit in.
 *
 * Resolution order: `git -C <path>`, then the last `cd <path>`, then the
 * payload cwd. Returns null when none of them is a work tree — which the caller
 * must treat as "cannot scan", not as "nothing to scan".
 */
export function resolveRepo(command, payloadCwd) {
  const explicit = []; // `git -C <path>` — the most specific signal
  const chdirs = []; // `cd <path>` — the last one is where the shell ends up

  for (const seg of segments(command)) {
    const toks = tokenize(seg);
    for (let i = 0; i < toks.length - 1; i++) {
      if (toks[i] === '-C' && looksLikeGit(toks[i - 1])) {
        explicit.push(unquote(toks[i + 1]));
      }
      if (toks[i] === 'cd') chdirs.push(unquote(toks[i + 1]));
    }
  }

  const candidates = [...explicit];
  if (chdirs.length) candidates.push(chdirs[chdirs.length - 1]);
  if (payloadCwd) candidates.push(payloadCwd);

  for (const c of candidates) {
    const root = toplevel(c);
    if (root) return root;
  }
  return null;
}
