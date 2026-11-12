# Case study: the CI gate, the review that found four holes in it, and the CI run that found a fifth

One rule, followed from a sentence in a file to a check with tests. It is here
because the interesting part is not the code. It is that the first version
looked finished, passed its own tests, and was still wrong in four ways that
only an outside reader found.

## 1. The requirement

The rule was already written down: run the repository's full CI before calling
work green, never one gate. An agent ran the one test it had touched, called it
green, and a stale test elsewhere reached the main branch.

A rule that depends on being remembered was not going to hold. So the
requirement became: **a commit in an opted-in repository cannot happen while
its full CI command fails.**

## 2. The first version

`hooks/lib/ci-gate.mjs`, loaded by the commit hook after the cheap checks.

- Opt-in. A central `ci-commands.json` maps a repository root to its command,
  so opting a repository in adds no file to it.
- A per-repository file, `.claude/ci-command`, overrides the central entry.
- Commits that touch only `.md` or `.txt` skip CI.
- It ran with 24 tests, all passing.

One thing was learned while building it: a hook that runs out of time does not
block, it lets the action through. The CI timeout (540 s) has to stay below the
hook timeout (600 s), or a slow suite silently switches the gate off.

## 3. The review

The repository was handed to a second model from a different vendor, with no
context and no hint of what to look for. Each finding was then checked against
the code before anything changed, because a reviewer with no repository
context is also sometimes wrong.

| Finding | Checked against | Held? |
|---|---|---|
| The secret scanner printed the line that matched, so a blocked key was copied into the hook output and the session log. | `lib/leak-scan.mjs`, where each finding stored the trimmed line | Yes |
| A guard that crashed let the commit through with a warning. | `commit-guards.mjs`, three `catch` blocks that wrote to stderr and carried on | Yes |
| An agent blocked by a failing suite could write `exit 0` into `.claude/ci-command` and commit. | `lib/ci-gate.mjs` read that file with no check on who wrote it | Yes |
| CI runs on the working tree, so a partly staged commit passes on code it does not contain. | Stated as a known limit in the file's own header | Yes, and already known |

Four findings, four held. None had been caught by the 24 passing tests,
because every test checked that the gate did what its author expected. None
checked what a motivated agent could do to it.

## 4. The fixes

**The scanner reports where, never what.** A finding is now a file, a line
number and a label. The line number comes from the diff's hunk headers. Tests
assert the secret is absent from the output and the line number is right.

**A confirmed commit fails closed.** A check that cannot load, or throws,
blocks and names itself. Everything that is not a commit is still let through,
because this hook runs on every shell command and a broken hook must not
freeze the shell. `test/fail-closed.test.mjs` copies the hooks to a temp
folder, breaks one file at a time, and runs the copy.

**The per-repository file is recorded outside the repository.** This one took
two designs.

The first design required the owner to approve every `.claude/ci-command`
before the gate would honour it. Before installing it, the existing checkouts
were listed. Eight of them, the main checkout and seven git worktrees, each
carried its own file, most with their own test port. Strict approval would have
blocked the first commit in every new worktree and made the owner run a
command for each one. A guard that interrupts legitimate work gets switched
off.

The second design is trust on first use, block on change. A file in a checkout
nothing else gates is recorded the first time the gate sees it. A file that
would replace a central entry, a recorded file that changed, and a recorded
file that disappeared all block until the owner runs
`approve-ci-command.mjs`. The record is a content hash in the hooks folder.
The table in [`hooks/README.md`](../hooks/README.md) lists every case, and
each row has a test.

**The working-tree limit is said out loud.** Checking out the staged snapshot
would need a second copy of every dependency. Instead, when a commit is
allowed while tracked edits or untracked files are left out of it, the agent
gets a note naming them.

## 5. The fifth hole, found by a machine

The fixes passed 121 tests on the author's Windows machine, from two
directories. They were pushed together with a GitHub Actions workflow that
runs the same tests on Windows and Linux.

The first run: Linux green, Windows red, six failures, all in the approval
tests.

The cause was in the log pattern, not in the test. On GitHub's Windows runners
the temp folder is spelled with a short name (`RUNNER~1`). Git
reports the same folder by its long name. The approval was stored under one
spelling and looked up under the other, so it was never found.

That is a real bug, not a runner quirk. The same thing happens when a checkout
is reached through a symlink, or on macOS, where `/tmp` is a link. The author's
machine has no short names in its temp path, so no number of local runs would
have shown it.

The fix resolves every path to its real spelling before it is compared or
stored. The new tests reach the test repository through a link, which
reproduces the fault on every operating system. They were run against the old
code first, to prove they fail without the fix: 5 failed. Then against the new
code: 0 failed.

## 6. What it does not do

- It does not stop an agent that edits the files in the hooks folder itself.
  That is a deliberate act outside its repository, covered by the written rule
  and by review, not by this mechanism.
- Whoever sets up a brand-new checkout chooses its first command. The merge
  into the main checkout is still gated by the main checkout's approved one.
- It checks nothing in a repository where the Markdown is the product.
- A commit that outlasts the hook timeout is let through by the harness.

## 7. The numbers

| | Before the review | After |
|---|---|---|
| Test cases across the hooks | 73 | 126 |
| Test files | 3 | 4 |
| Places a crashed check let a commit through | 4 | 0 known |
| Operating systems the tests had run on | 1 | 2 |

## What to take from it

1. Tests written by the author prove the author's expectations. Hand the thing
   to a reader with no context and ask what is wrong with it.
2. Check every finding against the code before acting on it, and say which
   held.
3. Before installing a stricter guard, list what already depends on the loose
   one. The first fix here was correct and would have been turned off within a
   week.
4. Write down what the guard does not do. A guard with unstated limits is
   trusted for things it never checked.
5. Run the tests on a machine that is not yours. "Passes from two directories"
   was true and proved less than it sounded like.
