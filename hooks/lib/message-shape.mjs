/**
 * Guard: stop `git commit -m` from being mangled by PowerShell.
 *
 * Windows PowerShell rewrites embedded quotes, eats backticks as escape
 * characters, expands `$`, and breaks pasted commands on line wrap. Three
 * separate sessions lost time to a commit message that arrived at git in a
 * different shape than it left the model. `git commit -F <file>` has no quoting
 * layer at all.
 *
 * This judges the MESSAGE, not the command line around it. Claude legitimately
 * runs long multi-line shell blocks that happen to contain a commit; blocking
 * those would make the guard useless noise. A short, plain, single-line `-m`
 * message passes untouched.
 *
 * Returns null to allow, or a string reason to block.
 */

import { isGitCommit, segments } from './git-command.mjs';

/**
 * Pull the `-m` argument out of the segment that actually runs `git commit`.
 * Returns null when there is no inline message to judge.
 */
function extractMessage(command) {
  for (const seg of segments(command)) {
    if (!isGitCommit(seg)) continue;
    // Already committing from a file? Nothing to guard.
    if (/\s-{1,2}(?:F|file)(?:=|\s)/.test(seg)) return null;

    const flag = seg.match(/(?:^|\s)-{1,2}m(?:essage)?(?:=|\s+)/);
    if (!flag) continue;

    let i = flag.index + flag[0].length;
    const quote = seg[i];

    if (quote !== '"' && quote !== "'") {
      const tok = seg.slice(i).match(/^\S+/);
      return { value: tok ? tok[0] : '', quote: null, closed: true };
    }

    let value = '';
    let closed = false;
    let escaped = false;
    for (let j = i + 1; j < seg.length; j++) {
      const c = seg[j];
      if (escaped) {
        value += c;
        escaped = false;
        continue;
      }
      if (c === '\\' && quote === '"') {
        escaped = true;
        value += c;
        continue;
      }
      if (c === quote) {
        closed = true;
        break;
      }
      value += c;
    }
    return { value, quote, closed };
  }
  return null;
}

export function check(command) {
  const msg = extractMessage(command);
  if (!msg) return null;

  const reasons = [];

  if (!msg.closed) {
    // The quote never closes inside this segment — the message ran past a
    // newline or a shell operator, which is exactly what breaks on paste.
    reasons.push('the quoted message is not closed on one line');
  }
  if (msg.quote && msg.value.includes(msg.quote)) {
    reasons.push(`it contains a nested ${msg.quote === '"' ? 'double' : 'single'} quote, which PowerShell strips or reorders`);
  }
  if (/[\r\n]/.test(msg.value)) {
    reasons.push('the message spans multiple lines');
  }
  if (msg.value.includes('`')) {
    reasons.push('it contains a backtick, which PowerShell treats as an escape character');
  }
  if (/\$\(|\$\{|\$env:/.test(msg.value)) {
    reasons.push('it contains shell interpolation ($(...), ${...} or $env:) that will expand');
  }
  if (msg.value.length > 140) {
    reasons.push(`the message is ${msg.value.length} chars — long enough to wrap and break on paste`);
  }

  if (reasons.length === 0) return null;

  return (
    `Blocked: this commit message will not survive the shell — ${reasons.join('; ')}.\n\n` +
    `Write the message to a file and commit from it instead:\n` +
    `  1. Use the Write tool to create .git/COMMITMSG (it is never tracked).\n` +
    `  2. Run: git commit -F .git/COMMITMSG\n\n` +
    `Do not retry with different quoting — the file path is the fix, not better escaping.`
  );
}
