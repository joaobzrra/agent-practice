---
id: windows-cross-shell-env-vars
title: Backgrounded processes on Windows drop your env vars
description: Prefixing env vars on a backgrounded command from Git Bash silently fails to pass them on. Set them inside the process's own shell with a wrapper script.
topic: gotchas
tags: [windows, powershell, git-bash, env]
updated: 2026-08-08
source: a PHP web app's test setup, where it happened more than once
status: current
---

# Backgrounded processes on Windows drop your env vars

Verified, more than once in the same project.

Backgrounding a server from Git Bash with prefixed variables
(`VAR=x php -S ... &`) silently drops them, and the failure shows up far away:
dozens of test checks failing with messages that never name the real cause.

**Fix:** a wrapper script that sets the variables inside the server's own
process, for example `powershell -File tests/start-server.ps1`, instead of
setting them in the calling shell. Applies to any Windows workflow that mixes
Git Bash and PowerShell where a background process needs environment
variables.

Related: [[uniform-failures-single-cause]] is what this looks like from the
test output.
