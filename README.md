<div align="center">

<img src="assets/logo.png" alt="Agent practice" width="130">

# Agent practice

**A working system for building real software with AI coding agents —
the rules, the roles, and the hooks that enforce them.**

<p>
<img alt="Node 18+" src="https://img.shields.io/badge/Node-18%2B-5FA04E?style=flat-square&logo=node.js&logoColor=white">
<img alt="Hooks: no dependencies" src="https://img.shields.io/badge/hooks-no%20dependencies-2DC6BB?style=flat-square">
<a href="https://github.com/joaobzrra/agent-practice/actions/workflows/hook-tests.yml"><img alt="Tests" src="https://github.com/joaobzrra/agent-practice/actions/workflows/hook-tests.yml/badge.svg"></a>
<img alt="Licence MIT" src="https://img.shields.io/badge/licence-MIT-F5A623?style=flat-square">
</p>

</div>

---

This is not a prompt collection. It is the operating agreement I work under,
extracted from production use across a commercial web store, a .NET back-office
platform, a desktop map editor, a live game server and a shipped UE5 game.

Every rule in here exists because its absence cost something.

That also means the rules come from one person's failures, on one person's
projects. Yours will differ. Keep the reason behind a rule and adjust the rule;
a rule copied without its reason is the first one an agent talks its way
around.

## New here? Read in this order

You do not need all of it. Start small and add a piece when its absence hurts.

1. **"The rules that matter most"**, below. Five minutes. If you take only one
   thing, take the three labels: Verified, Inferred, Assumed.
2. **[`lessons/`](lessons/README.md)**. Thirteen short stories of things that
   went wrong and the rule each one produced. Pick the three that sound like
   your last bad week.
3. **[`AGENTS.md`](AGENTS.md)**. Copy it into your own setup. Rewrite
   "Calibrating explanations" and "Environment" to describe you and your
   machine; an agent that knows who it is talking to explains better. Claude
   Code reads `CLAUDE.md`, not `AGENTS.md`, so the [`CLAUDE.md`](CLAUDE.md)
   here is one line that points at it. For a project's own file, start from
   [`templates/project-CLAUDE.md`](templates/project-CLAUDE.md).
4. **[`hooks/`](hooks/README.md)**. Install the commit guards. This is the step
   that turns advice into something the agent cannot skip.
5. **`skills/`**, one at a time, when you need it. `session-close` first. A
   `foundation-*` skill the next time you start a project. `ui-refine` the
   first time an agent builds you a screen.

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
| **`AGENTS.md`** | The working agreement. Every rule, and why it exists. `CLAUDE.md` is a one-line pointer to it. |
| **`templates/`** | A fill-in skeleton for one project's own instruction file: commands, full CI, boundaries, deploy target. |
| **`agents/`** | Four roles — `scout`, `researcher`, `implementer`, `reviewer` — each pinned to a model tier by the judgment its job requires. |
| **`skills/`** | Thirteen invocable procedures: four foundation protocols, a decision ledger, a knowledge library, a second-model consult, a session-close checklist, a deploy read-back, a visual-work loop, an orchestration guide, a questioning drill, and a security audit (Cloudflare's, see below). |
| **`hooks/`** | Guard hooks that block bad tool calls before they run. With tests. |
| **`lessons/`** | Thirteen field notes: what went wrong, why, and the rule it produced. |
| **`ledger/`** | The decision ledger as a tool you can copy into a project: a CLI, a hook, three schemas and 116 tests, set inside an invented example project with real output. Needs Node 24 and two packages. |
| **`library/`** | A starter cross-project knowledge library: the index builder with its tests, a document template, and six example entries. |
| **`case-studies/`** | One rule followed end to end: [the CI gate](case-studies/ci-gate.md), from a sentence in a file to a check, through a review that found four holes in it and a first CI run that found a fifth. |

## The rules that matter most

<table>
<tr><td width="34%"><b>Label every claim</b></td><td>
<b>Verified</b> — you ran it and read the output; quote the line or lines that prove it, not the whole output.
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
<code>skills/deploy-verify</code> is the procedure.
</td></tr>
<tr><td><b>Run the full suite, not one gate</b></td><td>
Work is green when the repository's whole CI command passes locally, not when
the one test you touched does. A commit hook runs it for you and blocks the
commit on failure.
</td></tr>
<tr><td><b>Looking is not delegated</b></td><td>
Anything judged by eye stays with the main model, which builds it, screenshots
it and compares it with a target set before the first line of code. One session
sent 28 UI slices to cheaper agents and took one screenshot; the result was
"pretty, but not what I expect". <code>skills/ui-refine</code> is the loop.
</td></tr>
<tr><td><b>Say what a false fix looks like</b></td><td>
So a coincidence is not mistaken for a result.
</td></tr>
</table>

## Rules are documentation. Hooks are enforcement.

`AGENTS.md` describes the discipline. `hooks/` makes it non-optional, because
quality that depends on remembering is not quality.

| Hook | What it does |
|---|---|
| `lib/leak-scan.mjs` | Blocks a staged diff containing a credential shape, or your username / email / home path in a source file. Reports the file and line, never the matching text. |
| `lib/message-shape.mjs` | Blocks an inline commit message the shell would mangle. PowerShell rewrites quotes, eats backticks and expands `$` — the fix is never better escaping, it is writing the message to a file. |
| `lib/ci-gate.mjs` | Blocks a commit in an opted-in repo whose full CI command fails. Also blocks when the file that names that command was changed to get past it. |
| `lib/deploy-freshness.mjs` | Warns, before a command that changes a remote target, about uncommitted files and unpushed commits: the state the target cannot have. |
| `identifier-guard.mjs` | Warns, after a file edit, about a freshly written game asset name, model hash or world coordinate, and asks where it came from. |

```console
$ node hooks/test/commit-guards.test.mjs
31 passed, 0 failed

$ node hooks/test/new-guards.test.mjs
21 passed, 0 failed

$ node hooks/test/ci-gate.test.mjs
58 passed, 0 failed

$ node hooks/test/fail-closed.test.mjs
16 passed, 0 failed
```

A guard nobody tests is a guard nobody can trust. One thing the CI gate taught:
a hook that times out does not block, it lets the action through. The hook's
timeout has to stay above the longest thing it runs.

A guard that crashes must not look like a guard that passed. On a commit, a
check that cannot load blocks. [`hooks/README.md`](hooks/README.md) has the
table of what happens in each failure, and what the guards do not catch.

## Agent roles, tiered by judgment

Delegation is a cost decision and a correctness decision at once. High-volume,
low-judgment work — searching, reading, checking versions and licences — goes to
cheap models, because its output gets verified anyway. Review does not, and runs
on the strongest model available.

Delegation also does not propagate: a subagent never spawns another subagent,
and never performs a merge, push, deploy, credential or destructive operation.
If a bounded task needs wider authority, it stops and reports back.

The first question is whether to delegate at all. With a large context and a
strong model driving, the handoff is often the most expensive part.
`skills/efficient-orchestration` gives three cases where it pays: breadth,
noise, and slices that own separate files.

## Several sessions at once

Two agent sessions editing one checkout overwrite each other. The rule in
`AGENTS.md` is one integrator in the main checkout and every other session in
its own git worktree (a second working copy of the repository on its own
branch). Only the integrator merges. A worker leaves its notes for the
integrator in its branch's handoff file.

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

Its scoring rules are measured, not guessed: word weights, a minimum match,
and a message size, each checked against real ledgers and replayed sessions,
because a ledger that injects everything is just a slower prompt.

It is the most-used piece of this setup. In the author's session logs a ledger
pack reached 93 of 259 main sessions, counting every project, with or without
a ledger.

Those logs also showed that nine packs in ten were too long for Claude Code's
10,000-character limit on hook output, so the agent received a file path and
the top of the list. The retrieval tests had passed the whole time: they
checked which claims were chosen, never what arrived. The tool now builds
every message to fit, sends each claim whole once per conversation, and sends
a claim scoped to a file when the agent opens that file.
[`ledger/README.md`](ledger/README.md) has the numbers before and after.

The tool is in [`ledger/`](ledger/README.md). That folder is an invented
project with the tool installed in it, so it runs as it is: three prompts
against four invented claims, and what a live session is sent, event by event.
[`ledger/tools/context-ledger/README.md`](ledger/tools/context-ledger/README.md)
has the steps to copy it into your own project, and its limits.

```console
$ cd ledger/tools/context-ledger && npm ci && npm test
ℹ tests 116
ℹ pass 116
ℹ fail 0
```

## Knowledge library

[`library/`](library/README.md) is where knowledge that outlives one project
goes: a brief per project, stack traps, procedures. An agent reads a generated
index of one line per document and opens only what the task needs. The builder
rejects a document that breaks the format, and `--check` fails when the index
is stale.

Its README includes what the author's own session logs show about which
entries get opened. The short version: project briefs, often; individual
traps, almost never, so the index line has to carry the whole point.

## Security audit

`skills/security-audit` is not mine. It is an unmodified copy of
[Cloudflare's security-audit skill](https://github.com/cloudflare/security-audit-skill),
MIT licensed, included because it is the security review this setup uses. Its
licence and the exact commit it was copied from are in that folder. Install the
current version from Cloudflare's repository rather than from here.

## Setup

The hooks need a local identity file to know what counts as *your* personal
data. It is gitignored, so it never ships:

```bash
cp hooks/identity.example.json hooks/identity.json
```

Fill in your own email, OS username and GitHub handle. Without it the generic
credential scanning still runs — the hook warns once and keeps working rather
than failing open silently.

To opt a repository into the full-CI gate, copy
`hooks/ci-commands.example.json` to `hooks/ci-commands.json` (also gitignored)
and list the repository's root with its full CI command. A repository that is
not listed is never slowed down.

Register the hooks in your Claude Code `settings.json`. The commit guards run
before a shell command (`PreToolUse`); the identifier guard runs after a file
edit (`PostToolUse`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node", "args": ["/absolute/path/to/hooks/commit-guards.mjs"], "timeout": 600 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node", "args": ["/absolute/path/to/hooks/identifier-guard.mjs"], "timeout": 15 }
        ]
      }
    ]
  }
}
```

Keep the `600`. The CI gate gives your test suite up to 540 seconds, and a hook
that runs out of time does not block the commit. A shorter hook timeout would
switch the gate off on a slow suite without telling you.

Then drop `skills/` and `agents/` into your `.claude/` directory.

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
