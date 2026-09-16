---
name: efficient-orchestration
description: Use whenever a task involves reading, searching, or researching a codebase, or implementing, fixing, refactoring or testing code — features, endpoints, components, bugs, migrations, scripts, spikes — in any project. Applies even when the user says nothing about delegation, subagents, cost or orchestration. Routes recon and research to cheap agents and keeps judgment, integration and review on the lead model.
---

# Efficient Orchestration

The lead model is the orchestrator, architect, integrator and final judge.
Cheap agents do the reading. The lead model does the deciding.

## The axis is reading vs judging, not easy vs hard

The intuitive rule — cheap model for easy code, expensive model for hard code —
is wrong, and this workspace has the receipts. On a native-rendering spike
project, **a mid-tier model built the DX11 renderer proof and the streaming
engine spike and both succeeded**, while a top-tier agent was spent exploring a
cloned repository read-only. Across one week, 199 subagents ran: **51% on the
top-tier model, and the over-provisioned ones were almost all recon and web
research, not code.**

So route on what the output *is*:

| The agent's output is... | Model | Why |
|---|---|---|
| **Locations** — where code lives, what calls what, file inventory, subsystem map | `scout` (Haiku) | Verifiable by grep; being wrong is cheap and obvious |
| **Facts** — docs, APIs, licences, versions, prior art, the real list of valid identifiers | `researcher` (Sonnet) | High token volume, low judgment; gets labelled and verified anyway |
| **Code behind a decided contract** — features, endpoints, components, localized fixes, refactors, pattern-following tests | `implementer` (Sonnet) | Mechanical once the design call is made. This includes work that *feels* hard |
| **A verdict** — is this diff correct, is this claim true, should this ship | `reviewer` (top-tier model) | Never cheapen this. A cheap reviewer approves exactly what a cheap implementer gets wrong |
| **A decision** — architecture, product, security, legal, what the user is told | The lead model, locally | Judgment is the deliverable |
| Anything blocking, tightly coupled, or needing the conversation | Keep local | The handoff costs more than doing it |

The four agents live in `~/.claude/agents/`. Use them by name — a model pinned in
a file cannot be forgotten, and a `model` parameter demonstrably is: over one
week Haiku was passed exactly once in 199 dispatches, and one repo went from 27
Sonnet runs historically to zero, with nothing to catch the drift.

## What the orchestrating model's own tokens are for

- Splitting work into slices that do not touch the same files.
- Writing the contract each agent builds against: types, file boundaries, invariants.
- Reading conflicting reports and deciding what is actually true.
- Verifying delegated work before it ships.
- The user-facing synthesis.

## Parallelism without collisions

Give each agent **disjoint files** and say so in the brief — "files you own,
touch nothing else". If two slices must touch one file, serialize them or do that
file yourself. When a UI slice depends on a data slice, put the shared types in
both briefs so they can run in parallel against one contract.

This discipline is already working here: zero verified parallel-edit collisions
in a week of heavy fan-out. Keep the sentence in every brief.

## Handoff packets

Write as if the agent has zero conversation context:

- Repo path, exact objective, and the files it **owns**.
- The contract: types, signatures, invariants that must hold.
- Conventions to match, and the existing helpers to reuse.
- The verification command, and what success looks like.
- **Stop conditions**: if the code contradicts the brief, if a command fails
  after a reasonable retry, or if the task needs out-of-scope files — stop and
  report rather than improvise.
- Ask for evidence: files changed, commands run, real output pasted,
  uncertainties named.

## Escalation

If the same agent fails the same task twice, do not send it a third time.
Escalate one tier — `scout` → `researcher`/`implementer` → `reviewer`/lead model →
the lead model does it locally — and say in the new brief what the previous
attempt got wrong. Two failures mean the brief or the diagnosis is wrong, not
the model.

When choosing between two tiers, take the cheaper one. The exception is anything
touching auth, money, production data or a migration: there, take the dearer one.

## The two failures that actually cost time here

Both are verification failures, and no model tier prevents either. Check for them
explicitly before reporting done.

1. **Invented identifiers.** The most frequent real defect in this workspace by a
   wide margin — a guessed prop model that silently killed a thread, an API that
   does not exist in the pinned version, an invented file path. The lead model
   wrote most of them. Every identifier and every physically meaningful number must be read
   out of a real list, schema or file, or the agent must stop and say it needs
   one. Grep each one in review.
2. **Reporting work as delivered before reading the target back.** Verified
   twice in one week: a VPS four commits behind while the user playtested the old
   resource, and a fix that was never committed at all. Before the word "done"
   or "deployed": compare local and remote state, confirm the files are present,
   hit the live thing, and state whether a cache or restart is involved.

## Vetting — the part that earns the savings

Treat every agent report as a lead, not a fact.

1. **Reopen the files they changed and read the diff yourself.** Reports describe
   intent; the diff is what ships.
2. **Re-run any load-bearing verification.** A licence reported by two separate
   agents was wrong both times and reached a NOTICES file before a first-person
   read caught it.
3. **Look for integration bugs the brief could not anticipate** — the agent only
   saw its slice. Check the callers of everything it changed.
4. **Say what you fixed** in the summary. The user is paying for the review
   layer; make it visible.

## Claims

3-5x cost efficiency on codebase-heavy work with independent slices is a
reasonable expectation, not a guarantee. The saving is real only while the
verification layer stays: cheap agents that ship unreviewed are how a codebase
accumulates quiet bugs.
