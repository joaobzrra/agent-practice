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
| `lib/ci-gate.mjs` | **Blocks** a commit when the repo's full CI command fails. Opt-in per repo; runs last, after the cheap checks pass. |
| `ci-commands.json` | Your local, git-ignored map of `"<repo root>": "<full CI command>"`. Copy `ci-commands.example.json` to create it. Absent means no repo has opted in. |
| `ci-command-approvals.json` | Local, git-ignored. One content hash per checkout that carries its own `.claude/ci-command`. Written by the gate and by the script below. |
| `approve-ci-command.mjs` | For the machine's owner: approve a changed per-repo command file, or revoke its record. |
| `identifier-guard.mjs` | **Advisory.** PostToolUse on `Edit`/`Write`/`MultiEdit`. Flags freshly written GTA/FiveM asset names, coordinate literals and rotation calls in `.lua`, and asks where each came from. |
| `test/commit-guards.test.mjs` | 31 cases covering both commit guards, the allow paths, the exemptions, the repo resolution, and that a blocked secret is not echoed. |
| `test/new-guards.test.mjs` | 21 cases covering deploy freshness and the identifier guard, including the silence cases. |
| `test/ci-gate.test.mjs` | 58 cases covering the CI gate: opt-in sources, docs-only skip, `-am`, ordering after the cheap checks, the per-repo file being edited, deleted or added to dodge the gate, one checkout reached through two spellings of its path, the working-tree note, broken config files. |
| `test/fail-closed.test.mjs` | 16 cases covering what happens when a guard file is itself broken: a commit blocks, everything else is left alone. |

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

## The full-CI gate

`lib/ci-gate.mjs` blocks a commit when the repository's full CI command fails.
It exists because the rule "run the full suite, not single gates" lived only in
prose, and a stale test got through. Now it is a check.

- **Opt-in per repo.** Copy `ci-commands.example.json` to `ci-commands.json`
  (git-ignored) and add `"<repo root>": "<full CI command>"`. A repo that is
  not listed is never slowed down. With no `ci-commands.json` at all, no repo
  has opted in.
- **Per-repo override.** `<repo>/.claude/ci-command` wins over the central map.
  The first non-blank line that does not start with `#` is the command. It is
  how each git worktree gets its own command, for example its own test port.
- **Docs-only commits are skipped.** If every file in the commit is `.md` or
  `.txt`, CI is not run. Know what that leaves out: in a repository where the
  Markdown *is* the product (skills, agent instructions), this gate checks
  nothing. Test those the way `lessons/test-rule-changes-on-fresh-agents.md`
  describes.
- **Runs last.** Only when the message-shape and leak-scan checks passed, so no
  CI time is spent on a commit that is already blocked.
- **Working tree, not the staged snapshot.** With a partly staged commit, CI
  also sees the unstaged edits and any new file that was never added. The gate
  cannot check out the staged snapshot without a second copy of the
  dependencies, so it says so instead: when a commit is allowed while tracked
  edits or untracked files are left out of it, the agent gets a note naming
  them.
- **A broken `ci-commands.json` or `ci-command-approvals.json` blocks.**
  Silently allowing every commit would switch the gate off without anyone
  noticing.

### The per-repo file cannot switch the gate off

`.claude/ci-command` lives inside the repository, which is where the agent
being gated works. The first version trusted it as found. An agent blocked by a
failing suite could have written `exit 0` into it and committed. An independent
review caught that before anyone did it.

The rule now is **trust on first use, block on change**. The record is a hash
per checkout in `ci-command-approvals.json`, here in the hooks folder, outside
any repository.

| The file is... | What the gate does |
|---|---|
| new, in a checkout the central map does not list (a fresh worktree) | Records it and uses it. No ceremony. |
| new, in a checkout the central map already gates | Blocks. It would replace an existing gate, so it needs approval. |
| recorded, and unchanged | Uses it. |
| recorded, and its content changed | Blocks until approved again. |
| recorded, and now missing | Blocks until the record is revoked. |
| recorded, with no command line in it | Falls through to the central map. |

```
node approve-ci-command.mjs <repo root>            # approve the file as it is now
node approve-ci-command.mjs <repo root> --revoke   # drop the record
```

That script is for the person who owns the machine. An agent that runs it to
get a commit through is bypassing the gate, and the block message says so.

Paths are resolved to their real spelling before they are compared, in the
central map, in the record and in the script. One directory can be reached
through a symlink, a Windows short name (`RUNNER~1`) or `/tmp` on macOS, and
git reports only the real one. The first version compared paths as typed; it
passed on the author's machine and failed on the first GitHub Actions run.

What this does not stop:

- Whoever sets up a brand-new checkout chooses its first command. The merge
  into the main checkout is still gated by the main checkout's own, approved
  command.
- An agent that edits `ci-commands.json` or `ci-command-approvals.json` in this
  folder. That is a deliberate act outside its repository. The written rule
  ("never disable or bypass a guard hook") and review cover it; this mechanism
  does not.

## When a guard itself fails

A guard that crashes and a guard that passes must not look the same.

| Situation | Result | Why |
|---|---|---|
| The hook input cannot be parsed | Allowed | Nothing is known about the command, and this hook runs on every shell call. |
| The command parser fails to load, and the line is plainly a `git commit` | **Blocked** | A commit that could not be checked. |
| The command parser fails to load, any other command | Allowed, with a warning | A broken hook must not freeze the shell. |
| `message-shape`, `leak-scan` or `ci-gate` fails to load or throws, on a commit | **Blocked**, naming the check | Same reason. |
| The repository cannot be determined | **Blocked** | The diff cannot be read. |
| An advisory (`deploy-freshness`, the working-tree note) throws | Allowed, silently | An advisory never takes down the call it advises on. |
| The hook runs out of time | Allowed | The harness does this, not the hook. See the timeout lesson below. |

The leak scan reports the file, the line number and what kind of thing it
found. It does not print the matching text, because that would copy the secret
into the hook output and the session log.

**Timeout lesson.** A hook that times out does not block; it lets the commit
through. The gate's own CI timeout is 540 s (`CI_TIMEOUT_MS`), so the
`PreToolUse` hook timeout you set when registering the hook must stay above
it. Use `"timeout": 600`; the repository README shows the full registration.
Raise the CI timeout and the hook timeout together, hook always larger.

## Running the tests

```
node test/commit-guards.test.mjs
node test/new-guards.test.mjs
node test/ci-gate.test.mjs
node test/fail-closed.test.mjs
```

Run them from this directory or from anywhere else — all resolve the hooks
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
