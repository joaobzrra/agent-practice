---
name: library
description: Use when saving durable knowledge to the cross-project library or updating an existing entry — trigger on "save this to the library", "file this lesson", "add to the library", "update the brief for X", or when a session produces a lesson that cost time once and applies beyond the current project. Encodes the exact filing procedure; never improvise frontmatter.
---

# Filing to the Library

> **Not included in this repository:** the library's own tooling
> (`tools/build-index.mjs`, which validates frontmatter and regenerates the
> index, and `templates/doc-template.md`). The skill is published for the
> filing procedure and the frontmatter rules. Steps 3 and 5 need your own
> builder and template.

`<library-root>` is the global two-tier knowledge library (index always loaded,
documents on demand). This skill is the *how* of filing; the *when* is your
judgment or the user's explicit ask.

## Does it belong here?

File it only if **all three** hold:

1. It cost time or could cost time once.
2. It applies beyond the project it was learned in — or it is a project brief
   update (`projects/` is the exception: routing summaries per project).
3. It is not already recorded in the target project's CLAUDE.md in a way agents
   will find. Project-specific truth stays in the project; the library gets
   the generalized lesson.

If in doubt, file it — a wrong doc is one `git rm` away; a lost lesson costs
an afternoon twice.

## Procedure

1. Read `<library-root>/INDEX.md` first. If an entry already covers the subject,
   **update that document** (keep its `id` forever) instead of creating a near
   duplicate. Bump its `updated` date.
2. New doc: pick the folder — `projects/` (briefs), `stacks/` (technology
   knowledge), `procedures/` (cross-project how-tos), `gotchas/` (traps),
   `evaluations/` (tool verdicts), `references/` (external pointers).
3. Copy the frontmatter block from `<library-root>/templates/doc-template.md`.
   Rules the builder enforces — write to them, don't fight them:
   - `id`: unique kebab-case, permanent. Never changed on rename or move.
   - `description`: one line, ≤200 chars, carries the whole point — agents
     route from this line alone.
   - `topic` must equal the folder; `updated` is YYYY-MM-DD;
     `status` is `current` or `outdated`.
   - Single-line values only. No YAML block scalars (`>` / `|`).
4. Body: one subject per document. Label claims Verified / Inferred / Assumed.
   Cross-link related docs with `[[their-id]]`.
5. Rebuild: `cd <library-root> && node tools/build-index.mjs` — it validates and
   fails loudly; fix what it names. This regenerates `INDEX.md`, `index.json`,
   and `dashboard.html` together. Never hand-edit those three.
6. Commit in `<library-root>` with a one-line message naming the doc.

## Session close

When closing a session (or inside the `session-close` skill flow), run
`node tools/build-index.mjs --check` in `<library-root>`. If it reports stale,
rebuild and commit before ending.

## Superseding, not deleting

A doc that turns out wrong or obsolete: set `status: outdated` and add a line
pointing to what replaced it, or delete it if it was never true. A project
that ends keeps its brief, marked discontinued — the brief still answers
"what was that?" for one index line.
