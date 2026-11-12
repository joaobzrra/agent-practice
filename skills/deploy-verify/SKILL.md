---
name: deploy-verify
description: Use before saying "deployed", "live", "shipped" or "it's on the server", after any push, pull, upload or release that should reach a live target — and first when the user reports a deployed fix is "still broken", because stale code is the first suspect. Covers the four read-backs (commit, files, live hit, cache), a targets table that says where each target's own deploy procedure lives, and the report format. It verifies a deploy; the project's own deploy skill or runbook performs it.
---

# Deploy verify

Pushing is not deploying, and a green build is not a runtime result. Past
failures: a VPS that never pulled, so the user tested stale code and reported
three features broken; a client cache that kept serving an old resource after a
restart. In both, the knowledge existed. The check was not made.

This skill does not deploy. The project's own skill or runbook does (table
below). Run this after it, every time, before the word "deployed".

## The four read-backs

Run all four. Report all four. A skipped one is reported as skipped.

1. **Commit.** Read the SHA on the target (`git -C <path> log -1 --format=%H`,
   or the version string the target serves) and compare it to local
   `git rev-parse HEAD`. A mismatch is a hard stop: report it, do not retry
   the deploy blindly. When the user runs the pull themselves, ask them for
   `git log -1` output and read it; do not assume the pull ran.
2. **Files.** List the changed files on the target and confirm they are there.
   For static assets, compare hashes across three places: the git blob, the file
   on disk, and the file served over HTTPS. Identical in all three proves no
   cache sits between them.
3. **Live hit.** Hit the thing the change affects — curl the endpoint and show
   the status code, load the page and screenshot it (use `ui-refine` for
   anything visual), or perform the action. A 200 on the home page does not
   prove a change on another route.
4. **Cache layer.** Name every cache between the file and the user — opcache,
   CDN, service worker, browser cache, a game client's resource cache, an
   app's auto-update — and state for each whether this deploy needs a restart,
   a cache-bust or nothing. "A reload was enough" is a claim; back it with
   step 2's hashes.

## Targets

| Target | Who deploys, how | Target-specific read-back |
|---|---|---|
| Git-pull VPS or container app | The project's deploy script or skill pulls and restarts the service | `git log -1` on the server equals local HEAD; the container or service is running the new image or process; a health endpoint returns 200. |
| Shared host, no git checkout | Files are uploaded by hand or by a script | md5 of each uploaded file read back from the host and compared with the local copy; the backup location is named in the handoff. |
| Static or CDN site, deployed by a CLI | The hosting provider's CLI | The deployment id the CLI reports is the one serving the production URL; the asset hash served over HTTPS matches the build output; the CDN cache state is named. |

Replace this table with your own targets and each one's runbook.

For a target not in the table, find its runbook in the project's instructions,
status file or newest handoff before deploying. If none exists, say so and ask.

## Report

```
Deploy <project> — <what changed>
Local HEAD   <sha>
Target HEAD  <sha>                      (source: <command or the user's paste>)
Files        <n> present; <asset> md5 identical blob/disk/HTTPS
Live         <URL or action> -> <status / screenshot>
Cache        <each layer>: <restart | bust | none>, because <reason>
Not checked  <anything skipped, and why>
```

Every line is filled or explicitly marked skipped. Do not write "deployed" in
the summary if any line is a mismatch or skipped.
