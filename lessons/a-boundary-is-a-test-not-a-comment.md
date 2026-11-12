# A boundary is a test, not a comment

## What happened

Three boundaries mattered in two projects, and each one was at risk from a
future edit by an agent that had not read the comment explaining it.

- **A read-only client.** The code that talks to an outside task tracker must
  never write to it. Its interface has no write methods, and a test asserts
  exactly that. Adding a write method fails the suite.
- **An append-only writer.** The audit log (the record of who did what) must
  never be edited. A test asserts that the writer's interface has no update or
  delete method.
- **Tests isolated from local secrets.** The test host would otherwise load the
  developer's real local configuration, so tests for the "not configured" case
  passed only on a clean machine. Every test host now switches that loading off
  explicitly.

## Why it happens

An agent follows the code in front of it. A comment saying "never add a write
method here" is one more line of text, and the next session may not read it. A
failing test cannot be missed.

## The rule

- When a boundary carries weight (read-only, append-only, no secrets, module
  isolation), express it as a test on the shape of the code, run on every
  commit.
- A comment documents the boundary. A test defends it.
- Assert isolation; never assume it.
