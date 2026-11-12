---
name: ledger
description: Use when a decision, ruling, correction, gotcha or constraint lands in a project that has a context/ ledger — write the claim at that moment, not at session close. Also for superseding a claim that turned out wrong, contesting one you doubt, and checking ledger health. Covers the claim schema, how retrieval actually finds a claim, and the gates.
---

# The context ledger

> **Not included in this repository:** the `context-ledger` package this skill
> drives (`tools/context-ledger`, its CLI and its hook). The skill is published
> for the method: the claim schema, how retrieval scores a claim, and the
> gates. The commands below will not run until you supply your own
> implementation of that package.

A project's ledger is the thing that stops a session asking a question the
project already answered. It is not documentation and not memory — it is a set
of **claims** that a hook injects into sessions automatically, scored against
the prompt and the files in play.

Writing to it is a normal part of doing the work, like a commit.

## When to write

**At the moment of the decision.** When the operator says "we're going with X",
when a gotcha costs an hour, when a stated fact turns out false — write it
then, in that turn.

Not at session close. Session close is when context is most compressed and the
reasoning has already fallen out; that is exactly when a claim gets written
vaguely or not at all. The evidence and the ruling are both live only now.

Do not ask permission to record a claim. Write it and say you did, in one line.

**Write a claim when:**

- the operator rules on something, especially against your recommendation
- a gotcha burns time and would burn it again
- something you or a previous session stated confidently turns out wrong
- a constraint exists that the code does not show (a shared repo, a live
  customer, a boundary you must not cross)
- a convention is chosen where more than one was reasonable

**Do not write a claim for:**

- anything the code, the schema or `git log` already says plainly
- what you did this session — that is a handoff, not a claim
- a restatement of `CLAUDE.md`; cite it as `authority.source` instead
- a fact with no future reader: if no plausible future prompt should surface
  it, it is noise that costs tokens on every prompt it does match

## First: find the ledger

```
<project>/context/claims.json          the claims
<project>/context/documents.json       tracked documents and their anchors
<project>/context/scenarios.json       retrieval tests: prompt + paths -> expected claims
<project>/tools/context-ledger/        the vendored package (never edit here)
```

If `context/` does not exist, the project has no ledger. Offer to install one:

```bash
cd <project>/tools/context-ledger && node src/cli.mjs init
```

`init` scaffolds `context/` with schemas and templates. It has no rollback — a
mid-scaffold failure leaves a partial directory that the overwrite guard then
blocks; recovery is deleting the seconds-old `context/`.

The package is **vendored per project** because `ledger.mjs` derives the project
root from its own location. Never edit `tools/context-ledger/` in a project: fix
it in the canonical project where you maintain the source copy, run its tests
there, then re-vendor. An edit made in a vendored copy is destroyed by the next
refresh.

## Privacy: check before you commit

**Some ledgers are deliberately gitignored, and that is not a mistake to fix.**

A repository shared with a client can ignore `/context/` and
`/tools/context-ledger/` on purpose. A ledger accumulates internal reasoning and
material about another party's system, and none of it should reach a shared
history.

Before committing ledger files, run `git check-ignore -v context/claims.json`.
If it is ignored, leave it ignored: write the claim, run the gates, and do not
stage it. Do not offer `git add -f`, and do not suggest un-ignoring.

Repositories you own outright do commit their ledgers.

## Writing a claim

Edit `context/claims.json` with the file tools. **Never build claim text through
a shell command** — quoting eats backticks silently, and claim statements are
full of them.

The full shape, every field required unless marked optional:

```json
{
  "id": "CLM-crlf-fakes-corruption",
  "title": "Production Laravel files have CRLF endings, so md5 will not match the repo",
  "statement": "Production Laravel files carry CRLF line endings, so md5sum on the server does not match `git show HEAD:<file> | md5sum` even when the file is untouched — which looks exactly like someone hand-patched production. Before treating a mismatch as tampering, confirm `sed 's/\\r$//' <file> | md5sum` equals the repo blob.",
  "kind": "hazard",
  "state": "accepted",
  "authority": {
    "kind": "session",
    "source": "docs/handoffs/HANDOFF-2026-08-08-shared-pc-security.md",
    "decidedAt": "2026-08-08T00:00:00-03:00"
  },
  "scope": {
    "topics": ["crlf", "encoding", "deployment", "laravel", "producao", "deploy"],
    "paths": ["docs/handoffs/HANDOFF-2026-08-08-shared-pc-security.md"],
    "entities": ["md5sum", "CRLF"]
  },
  "universal": false,
  "severity": "high",
  "relationships": [],
  "evidence": [],
  "history": [
    { "from": null, "to": "accepted", "at": "2026-08-08T00:00:00-03:00",
      "actor": "session", "source": "docs/handoffs/HANDOFF-2026-08-08-shared-pc-security.md" }
  ]
}
```

`id` matches `^CLM-[a-z0-9-]+$`. Name it after the hazard, not the fix —
`CLM-crlf-fakes-corruption`, not `CLM-use-sed`.

`kind` is one of `invariant`, `fact`, `intent`, `hazard`, `conflict`.

`authority.kind` is one of `user`, `instruction`, `implementation`, `document`,
`session`. Use `user` when the operator decided it directly — that is the
strongest authority in the system and the one a later session must not quietly
overturn.

`severity` is one of `critical`, `high`, `medium`, `low`. It decides survival
when the budget overflows — for universal claims it is the primary ordering, so
a `low` universal claim is the first one dropped.

`singleValueKey` (optional) declares that only one active claim may answer a
question — `"primary-domain"`, `"hosting-tier"`. Two active claims sharing a key
raise a warning; two where one is `enforced` raise an error. Use it for facts
that have exactly one correct answer at a time.

### The statement is the whole claim

The statement is what a future session reads, usually with no other context. It
must carry the trigger, the symptom and the correction. Write the failure the
way it will actually appear:

> Bad: "Set the env vars before running the tests."
>
> Good: "The HTTP suite's server needs EDITOR_ALLOW_LOCAL_URLS and
> EDITOR_SSO_SECRET set in the server's own process, and prefixing them onto a
> backgrounded Git Bash `php -S` does not propagate. Start it with `powershell
> -File tests/start-server.ps1`. Set by hand, the failures do not name their
> cause: without EDITOR_ALLOW_LOCAL_URLS 37 checks fail on a shared
> `return_url invalida.` message."

A session that reads the second one recognises the failure it is looking at. A
session that reads the first one has learned nothing it can act on.

## Making sure it will actually be found

Retrieval is **lexical**, not semantic. This is the part that decides whether
the claim was worth writing.

    token overlap        ->   +2 each, over scope.topics/entities/title/statement
    path prefix match    ->  +12 each, bidirectional startsWith
    state 'contested'    ->   +3
    score 0              -> not retrieved, unless the claim is universal or
                            shares a conflictsWith component with one

Claims are admitted in two tiers. **Universal claims and anything sharing a
`conflictsWith` component with them go first**, regardless of score — that is
what `universal` buys. Everything else competes on score. Within the mandatory
tier, overflow drops by lowest **severity** first; within the scoped tier, by
lowest **score**. Ties break on id.

Four rules follow, in order of how much they matter:

1. **Prefer `scope.paths` over vocabulary.** A path match is worth six times a
   word match and needs no guess about how the question will be phrased. If the
   claim is about files, list them.
2. **Add local-language terms beside the English ones** in `topics`, if the
   operator prompts in more than one language. A prompt in the other language
   scores zero against English-only topics.
3. **Tokens of 2 characters or fewer are discarded entirely.** `db`, `ui`, `s3`
   do nothing. Spell them out somewhere in the claim.
4. **`universal: true` is expensive — default to `false`.** Universal claims are
   injected on every prompt in the project forever, and the routing budget is
   the ceiling every prompt can be made to pay. Measured on a real project
   ledger (2026-08-23, 50 active claims): the always-inject closure is 2 claims, a
   typical scoped prompt routes 2-9 claims for roughly 125-680 tokens, and a
   pack filled to the budget of 24 renders about **4.4k tokens**. Each new
   universal flag moves the floor toward that ceiling on every prompt forever.
   Reserve it for rules that are genuinely wrong to ever act without, and reach
   for `scope.paths` first.

### Prove it, don't hope

A claim nobody retrieves is worse than no claim — it reads as covered. Add a
scenario to `context/scenarios.json` with the prompt you expect a future session
to actually type:

```json
{ "id": "SCN-crlf-check",
  "name": "A production md5 mismatch is diagnosed before it is called tampering",
  "prompt": "o md5 do arquivo em producao nao bate",
  "paths": [],
  "expectedClaims": ["CLM-crlf-fakes-corruption"] }
```

`id` matches `^SCN-[a-z0-9-]+$`; `name`, `prompt`, `paths` and `expectedClaims`
are all required, and `expectedClaims` needs at least one entry.

Then confirm retrieval directly:

```bash
cd <project>/tools/context-ledger
node src/cli.mjs route --prompt "o md5 do arquivo em producao nao bate"
```

If the claim does not come back, the scope is wrong. Fix the scope, not the
scenario.

## State, and changing it

    proposed  -> accepted, verified, contested, superseded
    accepted  -> verified, enforced, contested, superseded
    verified  -> enforced, contested, superseded
    enforced  -> contested, superseded
    contested -> proposed, accepted, verified, enforced, superseded
    superseded -> (terminal)

**`proposed` is never routed.** `activeStates` is
`{accepted, verified, enforced, contested}` and the filter runs before scoring,
so a perfectly scoped `proposed` claim reaches no session at all. Writing a
claim as `proposed` and waiting is the same as not writing it. Use `proposed`
only when you are genuinely asking the operator to rule and will surface it in
the conversation.

Start at `accepted` when it is settled. Use `enforced` for a rule that must
never be violated, `verified` when a command or test proves it.

Every state change appends to `history`, and **the last history entry's `to`
must equal the claim's `state`** — validation checks this. Each entry needs
`from`, `to`, `at`, `actor`, `source`; `note` and `evidence` are optional.

### supersede — the claim was right, then reality moved

Never edit a wrong claim in place; the record of having believed it is worth
keeping. Write the new claim with a `supersedes` relationship, and move the old
one to `superseded`:

```json
{ "id": "CLM-routing-budget-24", "relationships": [{ "type": "supersedes", "target": "CLM-routing-budget-20" }] }
```

Then append to the old claim's history:

```json
{ "from": "enforced", "to": "superseded", "at": "2026-08-11T21:00:00-03:00",
  "actor": "session", "source": "HANDOFF-2026-08-11-context-ledger.md",
  "note": "the accepted claim set outgrew the budget" }
```

`superseded` is terminal and superseded claims are never routed.

### contest — you doubt it but cannot settle it

Move the claim to `contested` and say why in the history `note`. Contested
claims still route, and score **+3** so they surface more readily — the point is
to get the disagreement in front of the next session rather than to hide the
claim. Bring it to the operator; resolving it is a ruling, not a cleanup.

## The gates — always run these

```bash
cd <project>/tools/context-ledger
node src/cli.mjs validate        # schema, lifecycle, references, budget
node src/cli.mjs build-index     # regenerate the views; --check verifies instead
```

`validate` must print `valid: N claims, ...`. Common failures:

- `universal-overflow` — the always-inject set no longer fits `routingBudget`
  (24). **Demote a universal claim to a scoped one; do not raise the budget as a
  reflex.** Every point of budget is paid on every prompt.
- `history-state` — the last history entry disagrees with `state`.
- `lifecycle` — an illegal transition; check the table above.
- `single-value-conflict` — two active claims share a `singleValueKey`.
- `broken-scenario-reference` — a scenario names a claim id that does not exist.

Then, if and only if the ledger is committed in this project, stage
`context/` and the regenerated views with the work they came from.

## check — is the ledger still honest?

Run periodically, and at session close:

```bash
node src/cli.mjs validate
node src/cli.mjs check-stale      # claims whose evidence anchors have drifted
node src/cli.mjs dashboard        # authority, attention, evidence health
node src/evaluate.mjs             # every scenario still retrieves its claims
```

Read the result for three things the tools will not tell you:

- **Universal ratio.** If most routable claims are `universal`, the author has
  been over-using the flag and routing is degrading toward "inject everything".
- **Claims nothing routes.** A claim no scenario covers and no realistic prompt
  reaches is dead weight paid for in review time.
- **Claims contradicting the operator's current position.** They may
  contradict themselves between days. The ledger's job is to make that visible —
  contest one, do not silently drop it.

## Watch for

**The hook fails open and silent by design.** A broken install is
indistinguishable from "nothing matched". If a project's claims stop appearing,
check that `tools/context-ledger/node_modules` exists — `ajv` missing is the
common cause, and nothing will tell you.

**`build-index --check` compares bytes.** On Windows with `core.autocrlf`, git
materialises LF-written files as CRLF and the check reports drift on identical
content. Both committed ledgers pin their paths `text eol=lf` in
`.gitattributes`; if a new project reports impossible drift, that is the cause.

**Generated views are derived.** Never hand-edit `context/generated/` or a
generated `AGENTS.md` — `build-index` overwrites them. The `AGENTS.md` view is
opt-in and only emitted when the project supplies
`context/templates/AGENTS.md.tmpl`.
