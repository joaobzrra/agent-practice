---
name: ledger
description: Use when a decision, ruling, correction, gotcha or constraint lands in a project that has a context/ ledger — write the claim at that moment, not at session close. Also for superseding a claim that turned out wrong, contesting one you doubt, and checking ledger health. Covers the claim schema, how retrieval actually finds a claim, and the gates.
---

# The context ledger

> **The tool this skill drives is in this repository**, at
> [`ledger/tools/context-ledger`](../../ledger/tools/context-ledger/README.md):
> the CLI, the hook, the schemas and the install steps.
> [`ledger/`](../../ledger/README.md) is an invented project with the tool
> installed, and shows its real output for three prompts. The claim and the
> scenario used as examples below are from that project's ledger.

A project's ledger is the thing that stops a session asking a question the
project already answered. It is not documentation and not memory — it is a set
of **claims** that a hook injects into sessions automatically, scored against
the prompt.

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

If `context/` does not exist, the project has no ledger. Offer to install one.
The package's `README.md` has the steps in order (copy the folder, install its
two packages, create the ledger, register the hook). The command that creates
the ledger is:

```bash
cd <project>/tools/context-ledger
node src/cli.mjs init --name "<project name>"
```

`init` scaffolds `context/`: the schemas, three empty record files and a
config file. It has no rollback — a
mid-scaffold failure leaves a partial directory that the overwrite guard then
blocks; recovery is deleting the seconds-old `context/`.

The package is **vendored per project** because `ledger.mjs` derives the project
root from its own location. Never edit `tools/context-ledger/` in a project: fix
it in the canonical project where you maintain the source copy, run its tests
there, then re-vendor. An edit made in a vendored copy is destroyed by the next
refresh. `node check-vendor.mjs <other copy>`, run from the source copy,
reports whether a copy has drifted.

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
  "id": "CLM-bookings-table-lock",
  "title": "A bare ALTER on the bookings table blocks every page that reads it",
  "statement": "The `bookings` table is read by every page load and by the nightly reporting job. A bare `ALTER TABLE bookings` waits behind any long read, and every new read then queues behind the ALTER, so the site hangs until it finishes. Run schema changes on `bookings` with `SET lock_timeout = '3s'` and retry, never inside the reporting window (02:00 to 03:00).",
  "kind": "hazard",
  "state": "verified",
  "authority": {
    "kind": "session",
    "source": "HANDOFF-2026-03-02.md",
    "decidedAt": "2026-03-02T00:00:00Z"
  },
  "scope": {
    "topics": ["migration", "schema", "database", "bookings", "lock", "alter"],
    "paths": ["db/migrations"],
    "entities": ["bookings", "lock_timeout", "ALTER TABLE"]
  },
  "universal": false,
  "severity": "critical",
  "relationships": [],
  "evidence": [],
  "history": [
    { "from": null, "to": "accepted", "at": "2026-03-02T00:00:00Z",
      "actor": "session", "source": "HANDOFF-2026-03-02.md" },
    { "from": "accepted", "to": "verified", "at": "2026-03-09T00:00:00Z",
      "actor": "session", "source": "HANDOFF-2026-03-09.md" }
  ]
}
```

`id` matches `^CLM-[a-z0-9-]+$`. Name it after the hazard, not the fix —
`CLM-bookings-table-lock`, not `CLM-use-lock-timeout`.

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
> Good: "The HTTP suite's server needs ALLOW_LOCAL_URLS and SSO_SECRET set in
> the server's own process, and prefixing them onto a backgrounded Git Bash
> command does not propagate. Start it with `powershell -File
> tests/start-server.ps1`. Set by hand, the failures do not name their cause:
> without ALLOW_LOCAL_URLS 37 checks fail on one shared `invalid return_url`
> message."

A session that reads the second one recognises the failure it is looking at. A
session that reads the first one has learned nothing it can act on.

## Making sure it will actually be found

Retrieval is **lexical**, not semantic. This is the part that decides whether
the claim was worth writing.

    token overlap        ->   +2 each, over scope.topics/entities/title/statement
    path prefix match    ->  +12 each, bidirectional startsWith
    state 'contested'    ->   +3
    score 0              -> not retrieved, unless the claim is universal or
                            shares a conflictsWith component with a claim
                            that is retrieved

Claims are admitted in two tiers. **Universal claims and anything sharing a
`conflictsWith` component with them go first**, regardless of score — that is
what `universal` buys. Everything else competes on score. Within the mandatory
tier, overflow drops by lowest **severity** first; within the scoped tier, by
lowest **score**. Ties break on id.

Four rules follow, in order of how much they matter:

1. **List `scope.paths`, and do not rely on them.** A path match is worth six
   times a word match, but only where paths are supplied: `route --paths` and
   scenarios. The hook that runs on each prompt passes the prompt text and no
   file list, so in a live session a claim is found by its words alone. If the
   claim is about files, list them, and also give it the words a prompt about
   those files would contain.
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
{ "id": "SCN-bookings-migration",
  "name": "A migration on the bookings table surfaces the lock hazard",
  "prompt": "add a notes column to the bookings table",
  "paths": ["db/migrations/0042_booking_notes.sql"],
  "expectedClaims": ["CLM-bookings-table-lock"] }
```

`id` matches `^SCN-[a-z0-9-]+$`; `name`, `prompt`, `paths` and `expectedClaims`
are all required, and `expectedClaims` needs at least one entry.

Then confirm retrieval directly, **without `--paths`**, because that is what
the hook sees in a live session:

```bash
cd <project>/tools/context-ledger
node src/cli.mjs route --prompt "add a notes column to the bookings table"
```

If the claim does not come back, the scope is wrong. Fix the scope, not the
scenario. A scenario that passes only because of its `paths` proves less than
it looks: add the missing words to the claim's topics.

Then route one prompt that has nothing to do with the claim. It should not
come back. In a small ledger most sentences share a word with most claims, so
the first check passes for almost anything; the unrelated prompt is the one
that shows whether the claim's words are selective.

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
`from`, `to`, `at`, `actor`, `source`; `note` and `evidence` are optional. The
first entry has `"from": null` and may enter at any state.

### supersede — the claim was right, then reality moved

Never edit a wrong claim in place; the record of having believed it is worth
keeping. Write the new claim with a `supersedes` relationship, and move the old
one to `superseded`:

```json
{ "id": "CLM-routing-budget-24", "relationships": [{ "type": "supersedes", "target": "CLM-routing-budget-20" }] }
```

Then append to the old claim's history:

```json
{ "from": "enforced", "to": "superseded", "at": "2026-03-20T00:00:00Z",
  "actor": "session", "source": "HANDOFF-2026-03-20.md",
  "note": "the accepted claim set outgrew the budget" }
```

`superseded` is terminal and superseded claims are never routed.

### contest — you doubt it but cannot settle it

Move the claim to `contested` and say why in the history `note`. Contested
claims still route, and score **+3** so they surface more readily — the point is
to get the disagreement in front of the next session rather than to hide the
claim. Bring it to the operator; resolving it is a ruling, not a cleanup.

### an open question — nobody has decided yet

Record it, so an agent does not settle it by accident: `"kind": "conflict"`,
`"state": "contested"`, and a statement that says what is undecided and what
to do in the meantime. It routes on every prompt until it is closed.

When the operator rules, do not rewrite the question into the answer. Write
the ruling as a new claim (`intent` or `invariant`, `authority.kind` `user`)
with a `supersedes` relationship to the question, and move the question to
`superseded` with a history entry. Point any scenario that expected the
question at the ruling.

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
- `single-value-conflict` — two active claims share a `singleValueKey` and one
  of them is `enforced`.
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

**The hook fails open and silent by design.** A broken hook prints nothing; a
working one with no matching claim prints only the pack's heading line. Neither
is visible unless you look. If a project's claims stop appearing, run
`node src/cli.mjs validate`: malformed JSON in `context/` silences the hook,
and nothing will tell you. The hook itself needs no installed packages;
the CLI does, and fails loudly without `tools/context-ledger/node_modules`.

**`build-index --check` compares bytes.** On Windows with `core.autocrlf`, git
materialises LF-written files as CRLF and the check reports drift on identical
content. Pin the ledger's paths `text eol=lf` in `.gitattributes`; if a new
project reports impossible drift, that is the cause.

**Generated views are derived.** Never hand-edit `context/generated/` or a
generated `AGENTS.md` — `build-index` overwrites them. The `AGENTS.md` view is
opt-in and only emitted when the project supplies
`context/templates/AGENTS.md.tmpl`.
