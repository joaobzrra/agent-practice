---
name: consult-codex
description: Use when the user says "consult codex", "use consult codex", "ask codex" or wants a second opinion from Codex (OpenAI gpt-6-astra, via the Codex plugin) — at a FOUNDATION decision, a VALIDATION pass before shipping, or a GOALS review of design and UI. Claude runs every consult itself through Bash; the user never has to type a slash command. Covers the model and effort, the exact commands, how to brief Codex cold, and how to verify the reply before acting on it.
---

# Consulting Codex

Codex is the second opinion. It is reached through the `codex@openai-codex`
plugin, which drives the OpenAI Codex CLI.

## Model and effort

- **Model: `gpt-6-astra`** at the time of writing. `~/.codex/models_cache.json`
  lists the models your install offers; read it rather than trusting this
  line. When a newer model appears there, the user decides whether to switch;
  do not switch on your own.
- **Effort: `medium` at minimum.** Use `high` for a FOUNDATION consult. The
  plugin accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- Astra's own default effort is `low`. Never leave effort to the model default.

## How to run it — Claude runs it, always

The user asks in words ("use consult codex on the migration plan"). Claude picks
the gate and runs it through Bash. Never hand the user a slash command to type:
`/codex:review` and `/codex:adversarial-review` are marked
`disable-model-invocation`, so the Skill tool cannot call them, but the script
behind them can be run directly.

Find the script (the folder name is the plugin version and changes on update)
and keep its path in `CODEX`, which the commands below use. Shell variables do
not survive between tool calls, so set it in the same call that uses it:

```bash
CODEX=$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | tail -1)
```

Run from the repository under review (`cd` there first):

| Gate | Command |
|---|---|
| VALIDATION or FOUNDATION of a diff | `node "$CODEX" adversarial-review --wait --model gpt-6-astra "<brief>"` |
| Quick unbriefed diff pass | `node "$CODEX" review --wait --model gpt-6-astra` (rejects any brief text) |
| FOUNDATION, no diff (a plan or design) | `node "$CODEX" task --fresh --model gpt-6-astra --effort high "<brief>"` |
| GOALS, or any question | `node "$CODEX" task --fresh --model gpt-6-astra --effort medium "<brief>"` |

- `review` and `adversarial-review` review the working tree or branch diff
  (`--base <ref>` / `--scope working-tree|branch` to choose). They take no
  `--effort`; effort comes from `~/.codex/config.toml`
  (`model_reasoning_effort = "medium"`). Check the configured effort before
  relying on it. If that file says lower, use a `task` run with `--effort`
  instead.
- `task` without `--write` runs in a **read-only sandbox**. Never add `--write`
  to a consult. The session log under `~/.codex/sessions/<date>/` records
  `"sandbox_policy":{"type":"read-only"}`, the model and the reasoning effort,
  so you can confirm what actually ran.
- A review run is ephemeral and leaves no session log; its model comes from the
  `--model` flag (companion script passes it through, `model: request.model`).
- Runs take minutes. Use Bash `run_in_background` and wait for the
  notification. Filter the harmless `DEP0190` Node warning from the output.
- After a `task` run, `git status` must show nothing new.

Implementation handed to Codex (the `codex:rescue` skill, which adds `--write`)
is not a consult. It is a subagent with write access: only when the user asks,
scoped to named files, never at production or another developer's app, and the
diff is reviewed before anything reaches a commit.

## Read this before every consult

**Codex starts cold.** It has no memory of the project, of the user's ChatGPT
history, or of the last consult. Assume zero shared context.

**A bad brief returns confident nonsense.** Codex answers whatever it is asked,
with authority, whether or not it had the facts. The quality of the reply is set
almost entirely by the brief. Spend the effort there.

**Codex cannot see what you did not send.** It reasons from the paths and text in
the brief. A constraint that lives only in your head will be violated.

## The brief packet

Send these six parts, in this order, every time.

1. **ROLE** — "You are reviewing work on <project>."
2. **GOAL** — what the project is for, in three lines. Not what it does.
3. **QUESTION** — one question. Specific. Answerable.
4. **ARTIFACT** — the file paths, the diff, or the pasted text under review.
5. **CONSTRAINTS** — what cannot change, and why. Include the hard boundaries:
   production systems, another developer's app, the security model.
6. **USEFUL ANSWER** — what a good reply looks like. Name the format.

Skipping part 5 is the most common failure. It is the part that stops Codex
recommending a rewrite of something that is not allowed to change.

## Gate templates

### FOUNDATION — is the base right? (effort `high`)

`adversarial-review` with this brief when a diff exists, else a `task` run at
effort `high`. Reach for this before building on an architecture, a data model,
or a security boundary.

```
ROLE        You are reviewing the foundation of <project>.
GOAL        <three lines: what this exists to do>
QUESTION    We are about to build <X> on top of <Y>. Attack the base. Where does
            <Y> fail as we scale, extend, or secure it?
ARTIFACT    <paths to the schema, the module boundaries, the auth flow>
CONSTRAINTS <what is already live and cannot be rewritten, and why>
USEFUL      Rank the weaknesses by cost of fixing them later. For each, name the
            failure and the trigger condition. Say plainly if the base is sound.
```

### VALIDATION — what breaks that we missed? (effort `medium`)

`adversarial-review` with this brief. Reach for this before shipping something
risky.

```
ROLE        You are reviewing a change to <project> before it ships.
GOAL        <three lines>
QUESTION    We claim this change does <X> without affecting <Y>. What breaks?
ARTIFACT    <the diff, plus the files it touches>
CONSTRAINTS <what is live, what has users on it, what has no rollback>
USEFUL      Concrete failure scenarios only — inputs or state, then the wrong
            result. No style notes. If you find nothing, say so.
```

### GOALS — does this serve what the project is for? (effort `medium`)

A `task` run at effort `medium`, with the screenshot path or rendered output in
the brief.

```
ROLE        You are reviewing a design decision on <project>.
GOAL        <three lines: who uses this and what they need from it>
QUESTION    Does this serve that goal, or does it only look finished?
ARTIFACT    <screenshot path, URL, or the rendered markup>
CONSTRAINTS <brand rules, the project's language rules, the existing visual
            language, what the client already approved>
USEFUL      Name what fails the goal and why. Separate taste from function.
```

## Receiving the reply

**Never implement a Codex suggestion on its word.** It is reasoning about a
codebase it cannot see the whole of.

1. Extract each claim it makes about the code as a separate item.
2. Check each one against the repository.
3. Label it: **confirmed**, **wrong**, or **unknown**.
4. Report the labelled list to the user before you change anything.

```
Codex review (gpt-6-astra, effort medium) — 4 claims, 2 confirmed:

CONFIRMED  <claim> — verified at <file:line>
CONFIRMED  <claim> — verified by <command and result>
WRONG      <claim> — <what the code actually does>, see <file:line>
UNKNOWN    <claim> — cannot verify without <what is missing>
```

A wrong claim is not a failed consult. It tells the user which parts of Codex's
reasoning to discount next time.

## Other commands

| Command | Use |
|---|---|
| `/codex:transfer` | Creates a persistent Codex thread from this session. |
| `/codex:status` | Running and recent jobs. |
| `/codex:result` | Final output of a completed job. |
| `/codex:cancel` | Stops an active background job. |

## Cost

Each consult spends the user's Codex usage. Do not consult twice on the same
question. When the user asks for the consult, run it. When it is your own idea,
run it and report, except when the change under review is itself hard to
reverse (a migration, a production data change): then propose the consult first
and wait.
