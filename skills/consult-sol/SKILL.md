---
name: consult-sol
description: Use when consulting Sol (GPT, via the Codex plugin) for a second opinion — at a FOUNDATION decision, a VALIDATION pass before shipping, or a GOALS review of design and UI. Covers how to brief him cold and how to verify his reply before acting on it.
---

# Consulting Sol

Sol — the second-opinion model, GPT reached through the Codex CLI plugin. He is
reached through the `codex@openai-codex` plugin, which drives the OpenAI Codex
CLI.

## Read this before every consult

**Sol starts cold.** He has none of the user's ChatGPT history with Sol, no
memory of the project, and no memory of the last consult. Address him as Sol so
the working relationship stays consistent for the user, but assume zero shared
context.

**A bad brief returns confident nonsense.** Sol will answer whatever you ask,
with authority, whether or not he had the facts to answer it. The quality of the
reply is set almost entirely by the brief. Spend the effort there.

**Sol cannot see what you did not send.** He reasons from the paths and text in
the brief. If a constraint lives only in your head, he will violate it.

## The brief packet

Send these six parts, in this order, every time.

1. **ROLE** — "You are Sol. You are reviewing work on <project>."
2. **GOAL** — what the project is for, in three lines. Not what it does. What it
   is for.
3. **QUESTION** — one question. Specific. Answerable.
4. **ARTIFACT** — the file paths, the diff, or the pasted text under review.
5. **CONSTRAINTS** — what cannot change, and why. Include the hard boundaries:
   production systems, another developer's app, the security model.
6. **USEFUL ANSWER** — what a good reply looks like. Name the format.

Skipping part 5 is the most common failure. It is the part that stops Sol
recommending a rewrite of something that is not allowed to change.

## Gate templates

### FOUNDATION — is the base right?

Use `/codex:adversarial-review`. Reach for this before building on an
architecture, a data model, or a security boundary.

```
ROLE        You are Sol, reviewing the foundation of <project>.
GOAL        <three lines: what this exists to do>
QUESTION    We are about to build <X> on top of <Y>. Attack the base. Where does
            <Y> fail as we scale, extend, or secure it?
ARTIFACT    <paths to the schema, the module boundaries, the auth flow>
CONSTRAINTS <what is already live and cannot be rewritten, and why>
USEFUL      Rank the weaknesses by cost of fixing them later. For each, name the
            failure and the trigger condition. Say plainly if the base is sound.
```

### VALIDATION — what breaks that we missed?

Use `/codex:review`. Reach for this before shipping something risky.

```
ROLE        You are Sol, reviewing a change to <project> before it ships.
GOAL        <three lines>
QUESTION    We claim this change does <X> without affecting <Y>. What breaks?
ARTIFACT    <the diff, plus the files it touches>
CONSTRAINTS <what is live, what has users on it, what has no rollback>
USEFUL      Concrete failure scenarios only — inputs or state, then the wrong
            result. No style notes. If you find nothing, say so.
```

### GOALS — does this serve what the project is for?

No dedicated command. Send the screenshot or the rendered output with the brief.

```
ROLE        You are Sol, reviewing a design decision on <project>.
GOAL        <three lines: who uses this and what they need from it>
QUESTION    Does this serve that goal, or does it only look finished?
ARTIFACT    <screenshot, URL, or the rendered markup>
CONSTRAINTS <brand rules, pt-BR copy, the existing visual language, what the
            client already approved>
USEFUL      Name what fails the goal and why. Separate taste from function.
```

## Receiving the reply

**Never implement Sol's suggestion on his word.** He is reasoning about a
codebase he cannot see the whole of.

Process every reply this way:

1. Extract each claim he makes about the code as a separate item.
2. Check each one against the repository.
3. Label it: **confirmed**, **wrong**, or **unknown**.
4. Report the labelled list to the user before you change anything.

Report it in this shape:

```
Sol's review — 4 claims, 2 confirmed:

CONFIRMED  <claim> — verified at <file:line>
CONFIRMED  <claim> — verified by <command and result>
WRONG      <claim> — <what the code actually does>, see <file:line>
UNKNOWN    <claim> — cannot verify without <what is missing>
```

A wrong claim is not a failure of the consult. It is the most useful thing the
process produces, because it tells the user which parts of Sol's reasoning to
discount next time.

## Commands

| Command | Use |
|---|---|
| `/codex:review` | Standard read-only review. The VALIDATION gate. |
| `/codex:adversarial-review` | Challenges design choices. The FOUNDATION gate. |
| `/codex:rescue` | Delegates a task to Codex. **Writes code.** |
| `/codex:transfer` | Creates a persistent Codex thread from this session. |
| `/codex:status` | Running and recent jobs. |
| `/codex:result` | Final output of a completed job. |
| `/codex:cancel` | Stops an active background job. |

**`/codex:rescue` writes code.** Treat it as a subagent with write access. Scope
it to named files, state the constraints in the brief, and review the diff before
anything reaches a commit. Do not point it at production or at another
developer's app.

## Cost

Each consult costs the user's Codex usage. Propose the consult, name the gate and
the question, then wait for approval. Do not consult twice on the same question.
