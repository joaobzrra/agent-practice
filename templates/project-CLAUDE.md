# <Project name>

<!--
A starting point for a project's own instruction file. Copy it to the project
root as CLAUDE.md (or AGENTS.md, with a one-line CLAUDE.md that says
`@AGENTS.md`), fill in every <placeholder>, and delete the sections that do not
apply. Keep it short: it is loaded into every session.

It carries only what is true for THIS project. Rules that hold everywhere
belong in your global file (see ../AGENTS.md). Where the two disagree, this
file wins, except on Safety.

Write facts you looked up, never facts you remember. A wrong command here is
run by every future session.
-->

## What this is

<One paragraph. What the product does, who uses it, and whether it is live.
"Live, real customers, real money" changes how an agent should behave, so say
it.>

## Layout

- `<path>`: <what lives here>
- `<path>`: <what lives here>
- `<path>`: generated. Never edit by hand; regenerate with `<command>`.

## Commands

| To do this | Run this, from the repository root |
|---|---|
| Install | `<command>` |
| Run locally | `<command>`, then open `<URL>` |
| Run one test file | `<command>` |
| **Full CI** | `<the one command that runs every gate>` |

"Green" means the Full CI command passed, not one test. If the commit hook's
CI gate is installed, this is the command to register for this repository.

Interpreters that are not on `PATH`: `<absolute path>`.

## Language

- Code, comments and commit messages: <language>.
- Product UI and customer-facing copy: <language>.

## Boundaries

- **Production is** `<host or URL>`. Reading it is fine. Writing to it needs
  approval in that message.
- **Not ours:** `<path or repository>` belongs to <who>. Changes there are
  minimal, additive, on a branch.
- **Never commit:** `<file names>`.
- <Any rule that cost something to learn, with the reason in one clause.>

## Deploy

- Target: `<where it runs>`.
- How: `<command or runbook path>`.
- Proof it landed: `<URL or command that shows the running version>`.

## Where the state lives

- Decisions and their reasons: `<path>`.
- Newest handoff: `<path pattern, e.g. HANDOFF-YYYY-MM-DD.md>`.
- Open work: `<path or tracker>`.
