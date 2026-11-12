---
id: two-tier-knowledge-pattern
title: Two-tier knowledge pattern (index cheap, content lazy)
description: How to give agents a large knowledge store without filling their context. An always-available one-line index, and documents opened only on demand.
topic: procedures
tags: [agents, context, tokens, architecture]
updated: 2026-08-08
source: the design session for this library
status: current
---

# Two-tier knowledge pattern

The pattern this library is built on.

## The problem

Context only blows up when material is loaded whether or not it is needed.
Putting a whole knowledge base into an agent's instructions costs more with
every document added, and soon costs too much.

## The pattern

- **Tier 1, cheap to load:** an index with one line per entry (title, path,
  one sentence). A hundred entries is a few thousand tokens.
- **Tier 2, loaded on demand:** the documents themselves, opened only when the
  index line says they are relevant to the current task.

The index still grows by one line per document, so it has a budget:
descriptions are capped at 200 characters, enforced by the builder. At around
500 documents the index itself costs real tokens. If it gets there, split it
into one index per domain with a small master index on top. The pattern
survives; the file splits.

## Where the same pattern already runs

- Agent memory: an index file of one-line pointers, and one file per fact.
- Skills: the description is always visible, the body loads only when invoked.
- This library: `INDEX.md`, then `projects/`, `stacks/`, `procedures/`,
  `gotchas/`, `evaluations/`, `references/`.

## Rules that keep it working

- The index line must carry the point. An agent decides from that line alone
  whether to open the document.
- The index is generated from document frontmatter, never edited by hand
  (`tools/build-index.mjs`). Generating it prevents two copies of the same
  fact from drifting apart. It does not prevent staleness: the builder must be
  re-run after an edit, and `node tools/build-index.mjs --check` verifies it
  was (use it in CI or at session close).
- Project-specific truth stays in the project. The library holds only what
  outlives a single project.
