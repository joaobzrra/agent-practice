---
id: cross-platform-text-false-positives
title: CRLF and encoding mismatches fake corruption and drift
description: A hash mismatch across Windows/Linux is not proof a file drifted (CRLF). Normalize line endings before comparing. Garbled log text is often UTF-8 read as CP1252, not corruption.
topic: gotchas
tags: [windows, linux, encoding, deployment]
updated: 2026-08-08
source: a deploy check on a PHP web app, and a log-health check on a worker
status: current
---

# Cross-platform text false positives

Two ways Windows/Linux text differences imitate real problems. Both Verified.

- **Deployment drift that is not drift.** Files uploaded from Windows carry
  CRLF line endings, so a byte or md5 comparison against the repository's copy
  never matches, even when the content is identical. Normalize first, then
  compare: `sed 's/\r$//' file | md5sum`. Applies to any deploy verification
  across a Windows/Linux boundary.
- **Corruption that is not corruption.** Garbled characters in log output are
  usually an encoding mismatch (UTF-8 read as CP1252), not a broken pipeline.
  Check the reader's encoding before treating it as a bug.

The same fault applies to this library. `build-index.mjs --check` compares the
generated files byte for byte, and git on Windows may rewrite line endings on
checkout. That is why this folder has a `.gitattributes` file pinning them.
