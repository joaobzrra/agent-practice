---
id: unique-kebab-slug-never-changed-after-creation
title: Short human title (max 80 chars)
description: One line, max 200 chars. This is what agents see in INDEX.md. Make it carry the point.
topic: projects | stacks | procedures | gotchas | evaluations | references (must match the folder)
tags: [lowercase, keywords]
updated: YYYY-MM-DD
source: optional. URL or project the knowledge came from
status: current | outdated
---

# Short human title

Body. One subject per document. State how each non-obvious claim is known
(Verified / Inferred / Assumed), same convention as everywhere else.

Frontmatter is NOT full YAML: one `key: value` per line, single-line values
only. No block scalars (`>` or `|`), no multiline strings. The builder rejects
violations. `id` is permanent: if the file is renamed or moved, the id stays,
so links survive.
