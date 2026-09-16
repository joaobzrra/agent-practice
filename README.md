# Agent practice

A working system for building real software with AI coding agents — the rules,
the role definitions, and the hooks that enforce them.

This is not a prompt collection. It is the operating agreement I actually work
under, extracted from production use across a commercial web store, a .NET
back-office platform, a desktop map editor, a live game server and a shipped
UE5 game. Every rule in here exists because its absence cost something.

## The problem it solves

An agent that is wrong is manageable. An agent that is *confidently* wrong is
expensive, because the cost lands on you — you become its verification loop,
which is the one job you did not ask for.

The failures that actually hurt are not bad logic. They are plausible names and
numbers that were never checked: a guessed config key, a guessed asset path, a
guessed API field, a guessed world coordinate. Each one looks correct in the
diff, compiles, and fails only at runtime.

So the system is built around one idea: **a claim is worthless without its
evidence, and the evidence has to be produced before the claim.**

## What's here

| Directory | What it is |
|---|---|
| `AGENTS.md` | The working agreement. Every rule, and why it exists. |
| `agents/` | Four agent roles — `scout`, `researcher`, `implementer`, `reviewer` — each pinned to a model tier by the judgment its job requires. |
| `skills/` | Ten invocable procedures: four foundation protocols, a decision ledger, a knowledge library, a second-model consult, a session-close checklist. |
| `hooks/` | Guard hooks that block bad tool calls before they run. With tests. |

### The rules that matter most

**Label every non-obvious claim.** *Verified* — you ran it and read the output;
include the output. *Inferred* — you read the code but did not run it.
*Assumed* — you are guessing; say what would prove it. No confidence
percentages; a number invents precision you do not have.

**Never invent an identifier.** Read it out of the real list, the real schema
or the real file. If no such list exists, say so and ask. A number with
physical meaning gets computed or measured, never estimated.

**A subagent's report is a lead, not a fact.** Fan out agents for recon — that
works. But nothing a subagent reports enters a commit until you have opened the
cited file yourself and quoted the line that proves it. Two separate agents once
reported the same third-party licence wrongly, with full confidence, and only a
first-person read caught it.

**A deploy is not done until you have read it back.** Pushing is not deploying
and a green build is not a runtime result. Compare the remote SHA to the local
one, list the files on the target, hit the live endpoint, and say explicitly
whether the cache needs clearing. Report all three. Never fewer.

**Say what a false fix would look like**, so a coincidence is not mistaken for
a result.

### Rules are documentation. Hooks are enforcement.

`AGENTS.md` describes the discipline. `hooks/` makes the discipline
non-optional, because quality that depends on remembering is not quality.

| Hook | What it blocks |
|---|---|
| `lib/leak-scan.mjs` | A commit whose staged diff contains a credential shape, or your username / email / home-directory path in a source file. |
| `lib/message-shape.mjs` | An inline commit message that the shell would mangle. PowerShell rewrites quotes, eats backticks and expands `$`; the fix is never better escaping, it is writing the message to a file. |
| `lib/deploy-freshness.mjs` | A deploy claim that has not been read back from the target. |
| `identifier-guard.mjs` | An invented game asset name, model hash or world coordinate — the highest-frequency hallucination in game work. |

```
$ node hooks/test/commit-guards.test.mjs
28 passed, 0 failed

$ node hooks/test/new-guards.test.mjs
21 passed, 0 failed
```

The guards have tests because a guard nobody tests is a guard nobody can trust.

### Agent roles, tiered by judgment

Delegation is a cost decision and a correctness decision at the same time.
High-volume, low-judgment work — searching, reading, checking versions and
licences — goes to cheap models, because its output gets verified anyway.
Review does not, and runs on the strongest model available.

Delegation also does not propagate: a subagent never spawns another subagent,
and never performs a merge, push, deploy, credential or destructive operation.
If a bounded task needs wider authority, it stops and reports back.

### Foundation protocols

`skills/foundation-{web,software,mobile,ue5}` are kickoff interviews that force
the decisions projects usually discover too late — the auth and session model,
the offline story, the persistence and migration story, the performance budget
with actual numbers on actual reference hardware, and what enforces each one on
day one. They end by writing `docs/FOUNDATION.md` into the repo so later
sessions inherit the decisions instead of relitigating them.

They are deliberately adversarial. "Secure storage" is not a decision.
"Refresh token in Keychain/Keystore with device-only accessibility; access
token in memory; 15-minute access TTL; logout wipes both" is.

### Decision ledger

`skills/ledger` is a retrieval-scored store of rulings, corrections and
constraints, written at the moment a decision lands rather than reconstructed
at session close. It answers the question that wastes the most time in long
projects: *why is it like this, and did we already decide this?*

The scoring rules in that skill are tuned, not guessed — token overlap weights,
a 2-character token floor, and a measured per-prompt budget — because a ledger
that injects everything is just a slower prompt.

## Setup

The hooks need a local identity file to know what counts as *your* personal
data. It is gitignored, so it never ships:

```
cp hooks/identity.example.json hooks/identity.json
```

Fill in your own email, OS username and GitHub handle. Without it the generic
credential scanning still runs — the hook warns once and keeps working rather
than failing open silently.

Register the hooks in your Claude Code `settings.json` as `PreToolUse` entries
pointing at `hooks/commit-guards.mjs` and `hooks/identifier-guard.mjs`. Drop
`skills/` and `agents/` into your `.claude/` directory.

Requires Node 18+. No dependencies.

## A note on this repo

This repo was prepared for publication using the system it documents: a leak
scan over every file, first-person verification of every subagent's report, and
the test suites run from a second working directory to prove the path handling.
`lib/leak-scan.mjs` was rewritten during that pass — it used to hardcode the
author's identifiers, which would have published exactly the data it exists to
protect.

That is the honest version of what this is for.

## Licence

MIT. See [LICENSE](LICENSE).
