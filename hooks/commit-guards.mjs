#!/usr/bin/env node
/**
 * PreToolUse entry point for the commit guards.
 *
 * One process runs all the checks, because this hook fires on EVERY Bash and
 * PowerShell call and Node's startup — not the checks themselves — is the cost.
 * Two separate hook entries doubled that tax for no benefit.
 *
 * Nothing is loaded and no subprocess is spawned unless the command is actually
 * a `git commit`, so the common case is a bare Node start and an exit.
 *
 * Exit 0 = allow. Exit 2 = block, stderr goes back to Claude as the reason.
 */

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', async () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // never block on a payload we cannot read
  }

  const command = payload?.tool_input?.command ?? '';
  if (typeof command !== 'string' || !command) process.exit(0);

  // Cheap gate first: everything below only matters for a real commit, or for a
  // command that changes a remote target. Both tests are plain string work — no
  // import and no subprocess — so the common case stays a bare Node start and exit.
  const maybeCommit = command.includes('commit');
  const maybeRemote = /ssh|scp|rsync|sftp/i.test(command);
  if (!maybeCommit && !maybeRemote) process.exit(0);

  let isGitCommit, resolveRepo;
  try {
    ({ isGitCommit, resolveRepo } = await import('./lib/git-command.mjs'));
  } catch (e) {
    // Without the parser none of the checks can run. If this plainly is a
    // commit, block: a guard that cannot load must not wave a commit through.
    // Anything else is let through, so a broken hook cannot freeze the shell.
    if (/\bgit\b[^|;&]*\bcommit\b/.test(command) && !/--dry-run/.test(command)) {
      process.stderr.write(
        `Blocked: the commit guards could not load (${e.message}), so this ` +
          `commit was not checked.\n\nFix the hook files, or get the user's ` +
          `call before committing another way.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`commit-guards: parser failed to load: ${e.message}\n`);
    process.exit(0);
  }

  // Deploy freshness. ADVISORY ONLY — it reports state and never blocks, because
  // reading a live system is legitimate and a guard that blocks legitimate work
  // gets turned off. Skipped when the same line also commits: the commit guards
  // below are the stronger check and must not be pre-empted by an early exit.
  if (maybeRemote && !maybeCommit) {
    try {
      const df = await import('./lib/deploy-freshness.mjs');
      if (df.isRemoteMutation(command)) {
        const advisory = df.check(resolveRepo(command, payload?.cwd));
        if (advisory) {
          process.stdout.write(
            JSON.stringify({
              hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: advisory },
            }),
          );
        }
      }
    } catch {
      // An advisory must never take down the tool call it is advising on.
    }
    process.exit(0);
  }

  if (!isGitCommit(command)) process.exit(0);
  if (/--dry-run/.test(command)) process.exit(0);

  // Which repository does this land in? The payload cwd is the SESSION
  // directory, not where the command runs.
  const repo = resolveRepo(command, payload?.cwd);

  // A guard that cannot see the diff must not quietly wave the commit through.
  // The usual cause is a shell variable in the path (`cd "$REPO" && git
  // commit`), which the hook receives unexpanded and cannot resolve.
  if (!repo) {
    process.stderr.write(
      `Blocked: cannot tell which repository this commit lands in, so the secret ` +
        `and identifier scan could not run.\n\n` +
        `Re-run with a literal absolute path rather than a shell variable, e.g.\n` +
        `  git -C /absolute/path/to/repo commit -F .git/COMMITMSG\n\n` +
        `If the directory genuinely is not a git repository, the commit was going ` +
        `to fail anyway — check the path.\n`,
    );
    process.exit(2);
  }

  const reasons = [];

  // From here on this is a confirmed commit, so every check fails CLOSED: one
  // that cannot load, or that throws, blocks. Letting the commit through would
  // mean a broken guard and a working guard look the same from outside.
  const crashed = (name, e) =>
    `Blocked: the ${name} check crashed (${e.message}), so this commit was not ` +
    `checked.\n\nFix the hook, or get the user's call before committing ` +
    `another way.`;

  try {
    const shape = await import('./lib/message-shape.mjs');
    const r = shape.check(command);
    if (r) reasons.push(r);
  } catch (e) {
    reasons.push(crashed('message-shape', e));
  }

  try {
    const leak = await import('./lib/leak-scan.mjs');
    const r = leak.check(command, repo);
    if (r) reasons.push(r);
  } catch (e) {
    reasons.push(crashed('leak-scan', e));
  }

  // Full CI last, and only when the cheap checks passed: no reason to spend
  // minutes of CI on a commit that is already blocked.
  let ci = null;
  if (reasons.length === 0) {
    try {
      ci = await import('./lib/ci-gate.mjs');
      const r = ci.check(command, repo);
      if (r) reasons.push(r);
    } catch (e) {
      reasons.push(crashed('ci-gate', e));
    }
  }

  if (reasons.length === 0) {
    // Allowed. One thing is still worth saying: CI ran on the working tree, so
    // files this commit leaves out were part of what passed.
    try {
      const note = ci?.advisory(command, repo);
      if (note) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note },
          }),
        );
      }
    } catch {
      // An advisory must never take down the commit it is advising on.
    }
    process.exit(0);
  }

  process.stderr.write(reasons.join('\n\n---\n\n') + '\n');
  process.exit(2);
});
