# Library

A starter for a cross-project knowledge library: one folder, outside any single
project, for what an agent should not have to learn twice. Project briefs,
stack know-how, procedures, traps, tool verdicts, external pointers.

This folder is a working library. The builder is the one in daily use, with
one change: the dashboard page is optional here. The tests were written for
this release. The six documents are examples: five real entries with project
names removed, and one invented project brief, labelled as invented.

## How it works

Two tiers. The index is cheap, the content is lazy.

1. An agent reads [`INDEX.md`](INDEX.md): one line per document. That is the
   only file loaded up front.
2. It opens only the documents whose line matches the task.
3. It never bulk-reads the library.

The line an agent decides from looks like this:

```
- [A bracket in a git pathspec is a glob, and returns zero silently](gotchas/git-bracket-pathspec.md) — git reads \[name\] in a pathspec as a character class, so ...
```

`INDEX.md` is generated from each document's frontmatter by
`tools/build-index.mjs`. Nobody edits it by hand, so the index and the
documents cannot disagree. The builder also refuses a document that breaks the
contract: a missing field, a description over 200 characters, a `topic` that
does not match its folder, a duplicate `id`.

[`procedures/two-tier-knowledge-pattern.md`](procedures/two-tier-knowledge-pattern.md)
is the longer explanation, written as a library entry.

## What it costs, measured

The author's own library on 2026-11-12: 32 documents. `INDEX.md` is 9,293
bytes. The documents together are 69,548 bytes. Reading the index costs about
13% of reading everything, and the gap widens with every document added,
because an index line is capped and a document is not.

## What actually gets used

Counted from the author's local session logs (which library files agents
opened), not from memory:

- The documents opened most were **project briefs**: the same brief in up to
  six separate session logs. One index line answers "what is that other project?"
  without a trip through its codebase.
- **No gotcha was opened in more than one session.**

The second number is the useful one. It does not mean the gotchas were
worthless. It means their value landed somewhere else:

- **In the index line.** A description that carries the whole point does its
  job without the document being opened. Write the line as if nothing else
  will be read, because usually nothing else is.
- **At writing time.** Writing a trap down in a general form is the step that
  turns it into a rule. The incident in
  `gotchas/uniform-failures-single-cause.md` is the same one written up in
  [`lessons/uniform-failures-have-one-cause.md`](../lessons/uniform-failures-have-one-cause.md).
- **In the tooling.** `gotchas/cross-platform-text-false-positives.md` is the
  reason this folder has a `.gitattributes` file: the builder's `--check`
  compares bytes, and git on Windows rewrites line endings.

If you only build one part of this, build the briefs.

## Start your own

1. Copy this folder somewhere outside your projects.
2. Delete the six example documents. Keep `tools/`, `templates/` and
   `.gitattributes` (it is a hidden file; make sure it came along).
3. Run `node tools/build-index.mjs`. It writes an empty index.
4. Tell your agent where it is. The line in [`AGENTS.md`](../AGENTS.md) under
   "Reference library" is the one to copy.
5. Make it a git repository of its own, so a bad edit can be undone.

Needs Node 18 or newer. No dependencies.

## Add a document

1. Read `INDEX.md` first. If an entry already covers the subject, update that
   document instead of writing a near-duplicate.
2. Pick the folder (table below). Create `<kebab-case-name>.md`.
3. Start with the frontmatter from
   [`templates/doc-template.md`](templates/doc-template.md). `id` is permanent
   and unique: it never changes, even if the file is renamed or moved.
4. Run `node tools/build-index.mjs`. Fix whatever it names.
5. Commit. `node tools/build-index.mjs --check` exits non-zero when the index
   is stale; run it in CI or at the end of a session.

[`skills/library`](../skills/library/SKILL.md) is the same procedure written
for an agent.

## Folders

| Folder | What goes there |
|---|---|
| `projects/` | One brief per project: what it is, where it lives, its state, where its real documentation is. |
| `stacks/` | Knowledge about a technology: framework quirks, engine traps. |
| `procedures/` | Step-by-step how-tos that apply across projects. |
| `gotchas/` | Traps that cost time once and must not cost time twice. |
| `evaluations/` | Assessments of tools, services and libraries, each with a verdict. |
| `references/` | Pointers to external resources: URLs, dashboards, communities. |

A folder that does not exist yet is fine. The builder skips it.

## Rules

- One document, one subject. Split rather than grow.
- Project-specific truth stays in that project. The library holds what
  outlives a single project. Briefs are the one exception, and they are
  routing summaries: when a brief and the project disagree, the project wins.
- Never edit `INDEX.md` or `index.json` by hand. Run the builder.
- For machines, read `index.json`. Never parse `INDEX.md`.
- A document that is no longer true gets `status: outdated`, or is deleted. A
  library that keeps wrong entries teaches agents to distrust all of it.

## The files the builder writes

| File | For |
|---|---|
| `INDEX.md` | Agents and people. One line per document, grouped by folder. |
| `index.json` | Machines. The frontmatter of every document, no bodies. |
| `dashboard.html` | Optional. Written only if you add `tools/dashboard-template.html`: any HTML file containing the placeholder `/*__LIBRARY_DATA__*/`, which is replaced with every document as JSON. No template ships here. |

## Tests

```console
$ node tools/build-index.test.mjs
```

It copies the builder into a temp folder and builds small libraries there:
valid ones, stale ones, and one for each rule the builder enforces. It never
touches this folder.
