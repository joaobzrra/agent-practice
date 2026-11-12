---
name: efficient-orchestration
description: Use when a coding task is broad enough to split — recon across many files, external research, log or test-output triage, or implementation that divides into independent slices. Routes reading and bounded non-visual code to cheaper agents and keeps judgment, UI, integration and review on the lead model. Skip it for small or tightly coupled edits, and for visual/UI work — use `ui-refine` for that.
---

# Efficient Orchestration

The lead model is the orchestrator, architect, integrator and final judge.
Cheaper agents do the reading. The lead model does the deciding — and anything
judged by looking at it.

## First: should you delegate at all?

With a 1M-token context and a strong model driving, the handoff is often the
most expensive part. Delegate only when one of these is true:

- **Breadth** — the answer means sweeping many files or directories, and you
  need the conclusion, not the dumps.
- **Noise** — the input is high-volume and low-signal: logs, test output, web
  pages, docs.
- **Parallel slices** — the work splits into pieces that own disjoint files and
  share a contract you can write down.

Otherwise do it locally. Tightly coupled edits, anything you will iterate on
with the user, and anything that needs the conversation stay local.

## The axis is reading vs judging, not easy vs hard

Cheap models build hard code fine behind a clear contract — in a
native-rendering spike project, a mid-tier model built the DX11 renderer proof
and the streaming engine spike and both succeeded. Where premium tokens were
wasted was recon and web research. Across one week, 199 subagents ran: 51% on
the top-tier model, and the over-provisioned ones were almost all recon and web
research, not code.

Route on what the output *is*:

| The agent's output is... | Agent | Why |
|---|---|---|
| **Locations** — where code lives, call sites, file inventory | `scout` (Haiku) | Verifiable by grep; being wrong is cheap and obvious |
| **Facts** — docs, APIs, licences, versions, the real list of valid identifiers | `researcher` (Sonnet) | High volume, low judgment; gets labelled and verified anyway |
| **Non-visual code behind a decided contract** — endpoints, data layers, migrations, scripts, localized fixes, pattern-following tests | `implementer` (Sonnet) | Mechanical once the design call is made, including work that *feels* hard |
| **Anything judged by looking at it** — web or game UI, layout, spacing, typography, motion, 3D placement and orientation, level layout, meshes, materials | The lead model, locally, via `ui-refine` | See below |
| **A verdict** — is this diff correct, should this ship | `reviewer` (top-tier model), or the lead model locally | Never cheapen this. A cheap reviewer approves what a cheap implementer gets wrong |
| **A decision** — architecture, product, security, what the user is told | The lead model, locally | Judgment is the deliverable |

The agents live in `~/.claude/agents/`. Use them by name — a pinned model cannot
be forgotten; a `model` parameter demonstrably is: over that same week the
cheapest tier was passed exactly once in 199 dispatches.

### Why UI is not delegated

The transcripts show it. One desktop-app UI session sent 28 slices to
`implementer` and took one screenshot in the whole session; it ended with "It's
pretty, but it doesn't look like what I expect." Sessions where the main model
wrote the CSS and looked at the page after each change (74 and 79 browser calls)
got small tweak requests, not rewrites.

An implementer works from a text brief and never sees the page. Visual quality
comes from the build → screenshot → compare → fix loop, and that loop belongs
with the model that holds the visual target and the conversation.

Delegating *around* UI is still fine: a scout can inventory the components and
tokens, an implementer can build the API or data hook the component calls. The
markup, CSS and the look stay local.

## What the lead model's own tokens are for

- Deciding whether to split at all, and where.
- Writing the contract each agent builds against: types, file boundaries, invariants.
- All visual and interaction work.
- Reading conflicting reports and deciding what is actually true.
- Verifying delegated work before it ships.
- The user-facing synthesis.

## Parallelism without collisions

Give each agent **disjoint files** and say so in the brief — "files you own,
touch nothing else". If two slices must touch one file, serialize them or do that
file yourself. When a UI slice depends on a data slice, put the shared types in
the data brief and build the UI locally against the same contract.

## Handoff packets

Write as if the agent has zero conversation context:

- Repo path, exact objective, and the files it **owns**.
- The contract: types, signatures, invariants that must hold.
- Conventions to match, and the existing helpers to reuse.
- The verification command, and what success looks like.
- **Stop conditions**: the code contradicts the brief, a command fails after a
  reasonable retry, or the task needs out-of-scope files — stop and report.
- Ask for evidence: files changed, commands run, real output pasted,
  uncertainties named.

## Escalation

If the same agent fails the same task twice, do not send it a third time.
Escalate one tier — `scout` → `researcher`/`implementer` → `reviewer`/lead model →
the lead model does it locally — and say in the new brief what the previous
attempt got wrong. Two failures mean the brief or the diagnosis is wrong, not
the model.

Between two tiers, take the cheaper one — except for auth, money, production
data or a migration, where you take the dearer one.

## The two failures that actually cost time

Both are verification failures; no model tier prevents either.

1. **Invented identifiers** — a guessed prop model, an API missing from the
   pinned version, an invented path. The premium model wrote most of them. Every
   identifier and physically meaningful number is read out of a real list,
   schema or file, or the agent stops and says it needs one. Grep each in review.
2. **Reporting work as delivered before reading the target back** — a VPS four
   commits behind while the user playtested, a fix never committed. Before
   "done" or "deployed": compare local and remote state, confirm the files are
   present, hit the live thing, and state whether a cache or restart is involved.

## Vetting — the part that earns the savings

Treat every agent report as a lead, not a fact.

1. **Read the diff yourself.** Reports describe intent; the diff is what ships.
2. **Re-run any load-bearing verification.** A licence reported by two separate
   agents was wrong both times and reached a NOTICES file.
3. **Check the callers of everything it changed** — the agent only saw its slice.
4. **A visual claim is proven only by an image you opened yourself**, framed at
   the distance the user will see it (page viewport, play camera). An agent's
   "it renders" is not evidence — in one game project, three implementer
   "proven" visuals showed nothing, and 30-60 m survey shots hid defects visible at
   play zoom.
5. **Say what you fixed** in the summary, so the review layer is visible.

The saving is real only while this layer stays. Cheap agents that ship
unreviewed are how a codebase accumulates quiet bugs.
