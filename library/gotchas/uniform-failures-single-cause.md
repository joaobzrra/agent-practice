---
id: uniform-failures-single-cause
title: Mass uniform test failures usually mean one missing prerequisite
description: When a huge block of tests fails uniformly with empty or identical details, suspect one missing prerequisite (interpreter path, env var, credential) near the top of the log, not a regression.
topic: gotchas
tags: [debugging, testing]
updated: 2026-08-08
source: a PHP web app's HTTP test suite
status: current
---

# Mass uniform failures usually mean one missing prerequisite

Verified: without the interpreter path set, an HTTP suite failed 78 of 131
checks with an empty `[]` detail. It looked like a sweeping regression. The
real cause was one `php: command not found` on line 12 of the log.

**Heuristic:** breadth plus uniformity of failure is evidence *against* a real
regression. Real regressions fail specifically. Missing prerequisites fail
everything the same way. Read the top of the log for the one root error before
investigating any individual failure.

Related: [[windows-cross-shell-env-vars]] is one way the prerequisite goes
missing.
