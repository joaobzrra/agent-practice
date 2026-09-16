<div align="center">

<img src="assets/logo.png" alt="Agent practice" width="130">

# Agent practice

**A working system for building real software with AI coding agents —
the rules, the roles, and the hooks that enforce them.**

<p>
<img alt="Node 18+" src="https://img.shields.io/badge/Node-18%2B-5FA04E?style=flat-square&logo=node.js&logoColor=white">
<img alt="Dependencies: none" src="https://img.shields.io/badge/dependencies-none-2DC6BB?style=flat-square">
<img alt="49 tests passing" src="https://img.shields.io/badge/tests-49%20passing-2DC6BB?style=flat-square">
<img alt="Licence MIT" src="https://img.shields.io/badge/licence-MIT-F5A623?style=flat-square">
</p>

</div>

---

This is not a prompt collection. It is the operating agreement I work under,
extracted from production use across a commercial web store, a .NET back-office
platform, a desktop map editor, a live game server and a shipped UE5 game.

Every rule in here exists because its absence cost something.

## The problem it solves

An agent that is wrong is manageable. An agent that is **confidently** wrong is
expensive, because the cost lands on you — you become its verification loop,
which is the one job you did not ask for.

The failures that actually hurt are not bad logic. They are plausible names and
numbers that were never checked: a guessed config key, a guessed asset path, a
guessed API field, a guessed world coordinate. Each one looks correct in the
diff, compiles, and fails only at runtime.

So the system is built on one idea:

> **A claim is worthless without its evidence, and the evidence has to be
> produced before the claim.**

## What's here

| | |
|---|---|
| **`AGENTS.md`** | The working agreement. Every rule, and why it exists. |
| **`agents/`** | Four roles — `scout`, `researcher`, `implementer`, `reviewer` — each pinned to a model tier by the judgment its job requires. |
| **`skills/`** | Ten invocable procedures: four foundation protocols, a decision ledger, a knowledge library, a second-model consult, a session-close checklist. |
| **`hooks/`** | Guard hooks that block bad tool calls before they run. With tests. |

## The rules that matter most

<table>
<tr><td width="34%"><b>Label every claim</b></td><td>
<b>Verified</b> — you ran it and read the output; include the output.
<b>Inferred</b> — you read the code but did not run it.
<b>Assumed</b> — you are guessing; say what would prove it.
No confidence percentages: a number invents precision you do not have.
</td></tr>
<tr><td><b>Never invent an identifier</b></td><td>
Read it out of the real list, the real schema or the real file. If no such list
exists, say so and ask. A number with physical meaning gets computed or
measured, never estimated.
</td></tr>
<tr><td><b>A subagent's report is a lead, not a fact</b></td><td>
Fan out agents for recon — that works. But nothing they report enters a commit
until you have opened the cited file yourself and quoted the proving line. Two
separate agents once reported the same third-party licence wrongly, with full
confidence. Only a first-person read caught it.
</td></tr>
<tr><td><b>A deploy is not done until you read it back</b></td><td>
Pushing is not deploying and a green build is not a runtime result. Compare the
remote SHA to the local one, list the files on the target, hit the live
endpoint, and state whether the cache needs clearing. Report all of it.
</td></tr>
<tr><td><b>Say what a false fix looks like</b></td><td>
So a coincidence is not mistaken for a result.
</td></tr>
</table>

## Rules are documentation. Hooks are enforcement.

`AGENTS.md` describes the discipline. `hooks/` makes it non-optional, because
quality that depends on remembering is not quality.

| Hook | What it blocks |
|---|---|
| `lib/leak-scan.mjs` | A staged diff containing a credential shape, or your username / email / home path in a source file. |
| `lib/message-shape.mjs` | An inline commit message the shell would mangle. PowerShell rewrites quotes, eats backticks and expands `$` — the fix is never better escaping, it is writing the message to a file. |
| `lib/deploy-freshness.mjs` | A deploy claim that has not been read back from the target. |
| `identifier-guard.mjs` | An invented game asset name, model hash or world coordinate. |

```console
$ node hooks/test/commit-guards.test.mjs
28 passed, 0 failed

$ node hooks/test/new-guards.test.mjs
21 passed, 0 failed
```

A guard nobody tests is a guard nobody can trust.

## Agent roles, tiered by judgment

Delegation is a cost decision and a correctness decision at once. High-volume,
low-judgment work — searching, reading, checking versions and licences — goes to
cheap models, because its output gets verified anyway. Review does not, and runs
on the strongest model available.

Delegation also does not propagate: a subagent never spawns another subagent,
and never performs a merge, push, deploy, credential or destructive operation.
If a bounded task needs wider authority, it stops and reports back.

## Foundation protocols

`skills/foundation-{web,software,mobile,ue5}` are kickoff interviews that force
the decisions projects usually discover too late — the auth and session model,
the offline story, persistence and migrations, a performance budget with real
numbers on real reference hardware, and what enforces each one on day one. They
end by writing `docs/FOUNDATION.md` into the repo, so later sessions inherit
decisions instead of relitigating them.

They are deliberately adversarial:

> "Secure storage" is not a decision. "Refresh token in Keychain/Keystore with
> device-only accessibility; access token in memory; 15-minute access TTL;
> logout wipes both" is.

## Decision ledger

`skills/ledger` is a retrieval-scored store of rulings, corrections and
constraints, written when a decision lands rather than reconstructed at session
close. It answers the question that wastes the most time on long projects:
*why is it like this, and did we already decide this?*

Its scoring rules are tuned, not guessed — token-overlap weights, a 2-character
token floor, a measured per-prompt budget — because a ledger that injects
everything is just a slower prompt.

## Setup

The hooks need a local identity file to know what counts as *your* personal
data. It is gitignored, so it never ships:

```bash
cp hooks/identity.example.json hooks/identity.json
```

Fill in your own email, OS username and GitHub handle. Without it the generic
credential scanning still runs — the hook warns once and keeps working rather
than failing open silently.

Register the hooks as `PreToolUse` entries pointing at `hooks/commit-guards.mjs`
and `hooks/identifier-guard.mjs`, then drop `skills/` and `agents/` into your
`.claude/` directory.

## A note on this repo

It was prepared for publication using the system it documents: a leak scan over
every file, first-person verification of every subagent report, and the test
suites run from a second working directory to prove the path handling.

`lib/leak-scan.mjs` was rewritten during that pass. It used to hardcode the
author's identifiers — publishing it would have published exactly the data it
exists to protect.

That is the honest version of what this is for.

## Licence

MIT. See [LICENSE](LICENSE).
