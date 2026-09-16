/**
 * Warn before pushing work to a remote target that the local repository has not
 * actually handed over yet.
 *
 * Why this exists. Twice in one week a deploy was reported as done while the
 * target was running older code, and both times the user discovered it by
 * playtesting the wrong build:
 *
 *   - the VPS sat four commits behind with no `html/` folder — "you were
 *     playtesting the old resource the whole time";
 *   - a finished fix was never committed at all — "uncommitted on your PC,
 *     three modified files, never pushed, never pulled".
 *
 * Each cost a full round of the user's testing time, which is the scarcest
 * resource in this workflow. The failure is not knowledge, it is timing: the
 * check is obvious at the moment of the deploy and invisible five minutes later.
 * So this fires exactly then.
 *
 * ADVISORY ONLY. It never blocks. Reading a live system is always legitimate,
 * pinned-tag deploys of an older commit are legitimate, and unrelated dirty
 * files are normal. A guard that blocked those would be turned off, and a guard
 * that is turned off protects nothing. It reports state and lets Claude judge.
 */

import { execFileSync } from 'node:child_process';

const git = (repo, args) => {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/** Commands that move code onto, or restart, something that is not this machine. */
const TRANSPORT = /(^|[\s"'(])(ssh|scp|rsync|sftp)([\s"']|$)/i;

/**
 * Verbs that mean the remote call CHANGES the target rather than reads it.
 * `ssh host tail -f log` must stay silent — diagnosis is not a deploy.
 */
const MUTATION =
  /(git\s+(pull|fetch|reset|checkout|clone)|restart|reload|systemctl|docker|pm2|forever|deploy|ensure|refresh|npm\s+(ci|i|install|run)|dotnet\s+(publish|run)|composer|artisan|migrate|refreshall|stop\s|start\s)/i;

/**
 * True when this command line mutates a remote target.
 *
 * Deliberately does NOT use `segments()`. That splitter is built for the local
 * shell, and the interesting payload here lives inside quotes:
 * `ssh vps "cd /srv/app && git pull && systemctl restart app"` splits into three
 * pieces, leaving the transport in one and the mutation verb in another, so a
 * per-segment test sees neither together and stays silent on the exact case this
 * guard exists for.
 *
 * Instead: find where the transport starts and look for a mutation verb after
 * it. That keeps `git pull && ssh vps "tail log"` silent — the local pull is not
 * a deploy and everything after `ssh` is a read.
 */
export function isRemoteMutation(command) {
  const t = command.match(TRANSPORT);
  if (!t) return false;

  // scp/rsync/sftp move files: the transport alone is already a mutation.
  if (/(^|[\s"'(])(scp|rsync|sftp)([\s"']|$)/i.test(command)) return true;

  return MUTATION.test(command.slice(t.index));
}

/**
 * Report local state that the remote cannot possibly have yet.
 *
 * Returns an advisory string, or null when the tree is clean and pushed — the
 * common case, which must stay silent.
 */
export function check(repo) {
  if (!repo) return null;

  const status = git(repo, ['status', '--porcelain']);
  if (status === null) return null; // not a work tree; nothing to say

  // Tracked modifications only. Untracked scratch files are noise here.
  //
  // Parse by regex rather than a fixed slice: porcelain pads the status field to
  // two columns (` M path`), and the trim above eats the leading space of the
  // FIRST line only — so a fixed `slice(3)` silently truncates one filename and
  // no other. Strip the status letters instead of a character count.
  const dirty = status
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('??'))
    .map((l) => l.replace(/^[ADMRCU?!]{1,2}\s+/, ''));

  // Commits that exist locally and not upstream. No upstream => null, not zero.
  const ahead = git(repo, ['rev-list', '--count', '@{upstream}..HEAD']);
  const unpushed = ahead === null ? null : Number(ahead);

  const head = git(repo, ['rev-parse', '--short', 'HEAD']) ?? 'unknown';

  const problems = [];
  if (dirty.length) {
    const shown = dirty.slice(0, 8).join(', ');
    const more = dirty.length > 8 ? `, +${dirty.length - 8} more` : '';
    problems.push(`${dirty.length} tracked file(s) modified but not committed: ${shown}${more}`);
  }
  if (unpushed !== null && unpushed > 0) {
    problems.push(`${unpushed} commit(s) on HEAD not pushed to upstream`);
  }
  if (unpushed === null) {
    problems.push(`no upstream configured for this branch, so "pushed" cannot be confirmed`);
  }

  if (!problems.length) return null;

  return (
    `Deploy freshness check — local HEAD is ${head}.\n` +
    problems.map((p) => `  - ${p}`).join('\n') +
    `\n\nThis command changes a remote target, so anything listed above is NOT on it. ` +
    `Two deploys last week shipped stale code this way and the user found out by testing the wrong build.\n` +
    `Before reporting this deployed: commit and push what belongs in the deploy, then read the target back — ` +
    `compare its HEAD SHA to the local one, confirm the files are present, and say whether a restart or cache flush is needed. ` +
    `If the staleness is deliberate (pinned-tag deploy, unrelated dirty files), say so and carry on.`
  );
}
