---
id: example-booking-app
title: Tablebook (an invented example of a project brief)
description: INVENTED EXAMPLE. Restaurant booking web app, Next.js and Postgres, live with paying customers. Full CI is npm run ci. Deep docs are in the repo's CLAUDE.md and docs/FOUNDATION.md.
topic: projects
tags: [example, web, nextjs, postgres]
updated: 2026-11-12
source: invented for this repository, to show the shape of a brief
status: current
---

# Tablebook (an invented example)

This project does not exist. It is here to show what a brief looks like,
because briefs are the documents that get opened most.

A brief is a routing summary. It answers "what is X?" from one index line, so
an agent working somewhere else does not have to explore a second codebase to
find out. It is not a second home for the project's truth. When the brief and
the project disagree, the project wins and the brief gets updated.

## What it is

A web app where restaurants take table bookings. Live, with paying customers.

## Where it lives

- Repository: `<path on your machine>`
- Production: `<URL>`. Reading is fine. Writing needs approval.

## State on the `updated` date

- Bookings, cancellations and reminder emails are live.
- Waiting list: in progress on the branch `feat/waiting-list`.
- Frozen: the old admin panel. Bug fixes only.

## What an agent arriving cold needs to know

- Full CI: `npm run ci`. One passing test is not green.
- The database is shared with the reporting job. A slow migration blocks it.
- Customer-facing text is in Spanish. Code and commits are in English.

## Where the real documentation is

- `CLAUDE.md` in the repository root: commands, boundaries, deploy.
- `docs/FOUNDATION.md`: the decisions and their reasons.
- The newest `HANDOFF-*.md`: what was in progress last.
