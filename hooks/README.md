# Global Claude Code hooks

Installed 2026-08-23 from the `/insights` report covering 2026-07-04 → 2026-08-23.

## What is here

| File | What it does |
|---|---|
| `commit-guards.mjs` | PreToolUse entry point. Fires on `Bash` and `PowerShell`; exits immediately unless the command is a `git commit` or touches a remote target. |
| `lib/git-command.mjs` | Shared parser: is this a commit, which repo does it land in, which segment of the line is it. |
| `lib/message-shape.mjs` | Blocks `git commit -m` when the **message** will be mangled by PowerShell. Points at `git commit -F .git/COMMITMSG`. |
| `lib/leak-scan.mjs` | Blocks a commit whose staged diff contains a credential shape, or a personal identifier configured in `identity.json` (username / email / home-directory path) in a **source** file (docs and configs are exempt). |
| `lib/deploy-freshness.mjs` | **Advisory.** Before a command that mutates a remote target, reports uncommitted tracked files and unpushed commits — the state the target cannot have. |
| `identifier-guard.mjs` | **Advisory.** PostToolUse on `Edit`/`Write`/`MultiEdit`. Flags freshly written GTA/FiveM asset names, coordinate literals and rotation calls in `.lua`, and asks where each came from. |
| `test/commit-guards.test.mjs` | 28 cases covering both commit guards, the allow paths, the exemptions and the repo resolution. |
| `test/new-guards.test.mjs` | 21 cases covering deploy freshness and the identifier guard, including the silence cases. |

Registered in `../settings.json` under `hooks.PreToolUse` and `hooks.PostToolUse`.

## Why one process instead of two

The hook fires on every shell call — roughly 6,600 of them over seven weeks.
Node's startup, not the checks, is the cost: two hook entries measured 227 ms per
call, one entry measures **115 ms**. Keep every shell-triggered check inside
`commit-guards.mjs`. The identifier guard is a separate entry point only because
it fires on a different event — edits, not shell calls — so it adds nothing to
the shell path.

## The two advisory guards (added 2026-08-24)

Added from a forensic pass over 226 transcripts from 2026-08-17 → 2026-08-24.
Both target failures that a *blocking* guard cannot address, because in each case
the action itself is legitimate and only the missing check is not.

**Neither ever blocks.** They emit `hookSpecificOutput.additionalContext` and exit
0. This is deliberate: reading a live system is always legitimate, pinned-tag
deploys of an older commit are legitimate, unrelated dirty files are normal, and
most asset names are correct. A guard that blocked those would be turned off,
and a guard that is turned off protects nothing.

- **Deploy freshness.** Two deploys in one week shipped stale code and the user
  found out by playtesting the wrong build — a VPS four commits behind, and a fix
  that was never committed at all. The knowledge was never missing; the check was
  simply not made at the one moment it was cheap. Fires exactly then.
- **Identifier check.** The most frequent real defect across every project was a
  plausible-looking name or number that was never looked up — roughly ninety
  instances, most written by the *expensive* model. A guessed asset name fails
  silently at runtime; a guessed coordinate is visible only to the user, which
  turns him into the test loop.

Two traps worth remembering, both found by the tests rather than by review:

1. **Do not use `segments()` to detect a remote mutation.** It splits on `&&`,
   which shreds the quoted remote payload — `ssh vps "cd /srv && git pull"` puts
   the transport in one segment and the verb in another, so a per-segment test
   stays silent on the exact case the guard exists for. Match from the transport
   onward instead.
2. **Do not parse `git status --porcelain` with a fixed `slice(3)`.** The output
   is trimmed as a whole, which strips the leading space of the *first* line only
   — so exactly one filename comes back truncated and every other one is right.
   Strip the status letters by regex.

## Why these two guards

- **Message shape** — PowerShell quote mangling broke commits and pasted
  commands in at least three separate sessions.
- **Leak scan** — an author name reached shipped source and turned a release
  build red. It had to be stripped afterwards in a follow-up commit.

## Three design decisions worth keeping

1. **The message guard judges the message, not the command line.** Claude
   legitimately runs long multi-line shell blocks that end in a commit. An
   earlier version judged the whole string and blocked every one of them.
2. **An unresolvable repository is a BLOCK, not a skip.** The payload's `cwd` is
   the session directory, not where the command runs, and a path written as a
   shell variable (`cd "$REPO" && git commit`) reaches the hook unexpanded. When
   the repo cannot be determined the diff cannot be read, and a guard that
   cannot read the diff must not report a pass. The fix is a literal path:
   `git -C /path/to/repo commit -F .git/COMMITMSG`.
3. **Child stderr is suppressed explicitly.** `execFileSync` forwards a child's
   stderr to the parent by default, so a failed `git diff` dumped git's entire
   usage text into the block message.

## Behaviour to expect

A block cancels the **whole** tool call, not just the git line. If a multi-line
block staged files and then committed, the staging did not happen either — re-run
the setup steps after fixing the cause.

## Setting up `identity.json`

`lib/leak-scan.mjs` reads your personal identifiers (email, OS username, GitHub
handle, home-directory segment) from `identity.json` next to this README, not
from the source. Copy `identity.example.json` to `identity.json` and fill in
your own values — it is git-ignored and never leaves your machine. Without it,
the credential-shape checks (private keys, API tokens, assigned passwords)
still run; only the personal-identifier scan is disabled, and the hook prints
a one-line warning saying so.

## Running the tests

```
node test/commit-guards.test.mjs
node test/new-guards.test.mjs
```

Run them from this directory or from anywhere else — both resolve the hooks
and fixtures relative to their own file location, not a fixed path. Expected:
all cases passing. They build and delete a throwaway git repo in the temp
directory; they never touch a real project.

## If a guard blocks something it should not

Fix the line, or say it looks like a false positive and let the user decide.
Do not disable the hook to get a commit through — that is the one failure mode
these are designed to make impossible.

To turn them off deliberately, remove the `hooks.PreToolUse` entry from
`../settings.json`. The scripts can stay in place.

## Related

A project-scoped hook can live in that project's own `.claude/` directory
instead of here — for example a language-specific lint ratchet on the same
`PreToolUse` event. If it needs to agree with these guards on what counts as a
commit, have it import `lib/git-command.mjs` from here rather than re-deriving
the same parsing rules.
