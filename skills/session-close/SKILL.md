---
name: session-close
description: Use when the user signals the end of a working session — "that's it for today", "I'm closing this", "push and we're done", "anything I forgot before I close it?". Runs the close checklist and writes a handoff document when the state is complex.
---

# Session close

The user ends sessions deliberately and resumes days later. What you fail to
write down now, the next session pays to re-derive.

## Checklist

Work through these in order. Report each one as done or not done. Do not report
a step as clean without running the check.

1. **Tests.** Run the project's suite. Report the actual counts. If you did not
   run it, say you did not run it.
2. **Tree.** `git status`. Name any file left uncommitted and say why.
3. **Commit and push.** The user's standing permission covers this once they have
   said to commit. Never push to main or production unless they said so in that
   message.
4. **Memory.** Write anything learned this session that a future session would
   otherwise re-derive: a gotcha, a decision and its reason, a command that only
   works one specific way. One fact per file. Update `MEMORY.md`.
5. **Handoff.** Write one if the state is complex. See below.
6. **Waiting on them.** List everything only the user can do. This goes first in
   your closing message, not last.
7. **Update any cross-project status tracker you maintain**, so it matches the current state.

## When to write a handoff document

Write one when any of these is true:

- The work stopped mid-task and the next session must resume inside it.
- The session produced gotchas that cost real time to find.
- A migration, a deploy, or a dated cutover is pending.
- More than a few commits landed and their order matters.

Skip it for a single contained fix. A handoff nobody needs is noise in the repo
root.

## Handoff format

Save as `HANDOFF-YYYY-MM-DD.md` in the repository root, unless the project's
instructions name another place. Commit it.
If a handoff for that date already exists, add a new dated section to it; never
overwrite it. A run that crosses midnight keeps its start date.

This is the one handoff format. The mid-session stub that AGENTS.md asks for
before long work uses the same fields, so resuming from either is mechanical.

```markdown
# Handoff — YYYY-MM-DD

## Done
- <commit sha> — <what it changed, in one line>

## In progress
- <file path> — <exactly what state it is in>

## Open decisions
- <the decision> — recommendation: <yours, and why>

## Blocked on
- <the external dependency, named>

## Gotchas — do not re-derive these
- <the trap, what it looks like when you hit it, and the fix>

## Next action
<the literal first command to run>, then in priority order:
1. <the next task, and why it is first>

## Waiting on the user
- <anything only they can do>

## For the integrator
<!-- Worker branches only (AGENTS.md, Parallel sessions); omit otherwise. -->
- Ledger: <a ruling the user gave, in their words>
- Dependency: <a package.json change>
```

The gotchas section is the one that pays for the document. Write the symptom as
well as the cause — the next session recognises the symptom first.

## Closing message

Keep it short. The user is closing the laptop.

```
Waiting on you: <one line each, or "nothing">

Done: <what landed, and what proves it>
Pushed to <branch> at <sha>.

Next session starts at: <the file to read, or the first task>
```

Then answer the question they ask every time, before they ask it: anything they
forgot.
