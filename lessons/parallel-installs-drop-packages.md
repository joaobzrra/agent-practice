# Parallel installs drop packages

## What happened

A repository held several packages in one workspace (one shared lockfile, the
file that records exact dependency versions). Several implementer agents worked
in parallel, and each ran `npm install` for its own package.

The installs raced on the shared lockfile and the shared `node_modules` folder.
One run silently removed the whole `dependencies` block from another package's
`package.json`. The web app lost its UI library mid-session, and the build
failed with "failed to resolve import".

Nothing reported an error at the moment the damage happened.

## Why it happens

A package manager assumes one install at a time per folder. Agents running in
parallel do not know about each other.

## The rule

- Install every dependency up front, before fanning out.
- In each brief, tell the agent to list the dependencies it needs in its
  report, not to install them.
- If an install is unavoidable mid-run, run installs one at a time.
- After a parallel phase, re-read each `package.json` and run the build before
  trusting it.
- Sessions in separate git worktrees each have their own `node_modules`, so
  they do not race with each other.
