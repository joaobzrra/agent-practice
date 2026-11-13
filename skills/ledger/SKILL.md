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

### A shared ledger

A lesson about a stack (an engine, a framework, a toolchain) is true in every
project that uses it. It goes in a shared ledger: a folder of its own with the
tool installed, an `appliesTo` list in its `context/ledger.config.json`, and
its hook registered in the user settings. The package's `README.md` has the
steps under "One ledger for several projects".

When a message is headed with a name that is not the project's, it came from
a shared ledger: the heading is that ledger's `displayName`. The command it
gives for reading a claim carries that ledger's full path and runs from any
folder; use it as printed, not the project form. Write to a shared ledger
from its own folder (`cd <shared ledger>/tools/context-ledger`), with the
same claim shape and the same gates.

A shared ledger opens every session it applies to with its heading and a
count of its claims, even when it has no universal claim. If that block is
missing in a project it should serve, check in this order: a file matching
`appliesTo` is in the session's folder, above it or directly under it;
`validate` passes in the shared ledger's folder; its hook is in the user
settings. Registering it there is the operator's step: give them the entry
to add, do not edit the user settings yourself. A session started before the
registration does not have the hook; start a new one.

Before writing a claim, decide where it belongs. Would it bite a new project
on the same stack with different features? Then it is a shared claim: write
it without any name that belongs to one project (a class, a file, a level;
those go in `detail`, as where the lesson was learned). If it is about this
project's design or code, it stays in the project's ledger. If no shared
ledger exists for that stack, write it in the project's ledger and say so to
the operator: starting a shared ledger is their call.

Three things differ in a shared ledger:

- `authority.source` names what the lesson came from in words a reader in
  another project can follow (`"session, 2026-03-02"`, an engine source file,
  a document's path). A handoff name from one project means nothing there.
- `scope.paths` is matched against the session's project, so use a path only
  when every project on the stack has that file at that place (a config file
  the stack defines).
- The ledger may list `ignoreWords` in its config: words every claim shares,
  dropped from every prompt. A topic that is on that list finds nothing.
  Read the list before choosing topics. It is usually strict as well
  (`matching`, under "Making sure it will actually be found"): it is read in
  sessions about something else, where a loose match is noise.

A shared ledger that is a git repository is separate from the project's: a
commit in the project does not cover it. Stage the claim there and commit it
under the same rule as any commit, when the operator says to commit.

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

`detail` (optional) is a longer text kept beside the statement and never sent
by the hook. The next section says what goes in it.

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

**Keep it under about 600 characters.** The hook sends a claim whole or not at
all, in a message that holds 9,000 characters. A claim that does not fit
arrives as its title and a command to read the rest. The good example above is
362 characters. `validate` warns once a statement passes 3,000 characters;
that is the point of failure, not the target.

**What does not fit goes in `detail`.** `detail` is an optional second text
on the claim, of any length: the measurements, how the problem was found, the
cases that were ruled out. The hook never sends it. A claim that has one is
sent as its statement followed by `[+detail]`, and the message says once
which command prints the rest (`expand --claim <id>`). Words in `detail` are
matched like words in the statement, so moving text there does not change
which prompts find the claim.

The test for what stays in the statement: a session that reads only the
statement, and never runs `expand`, must still do the right thing. Evidence
that a careful reader would want before overturning the claim belongs in
`detail`. A step the next session must take does not.

To shorten a statement that already exists, move the old text into `detail`
unchanged and write a new, shorter `statement`. If the claim already has a
`detail`, put the old statement first and keep what was there after it. The
claim's `state` and `history` do not change: this is a rewording of a claim
that is still right, not a supersede. Nothing is lost, and a
conversation that holds the old wording is sent the new one once, marked as
changed.

## Making sure it will actually be found

Retrieval is **lexical**, not semantic. This is the part that decides whether
the claim was worth writing.

    word in title, topics, entities   ->   +4 per distinct word
    word only in the statement        ->   +2 per distinct word
    word only in the detail           ->   +2 per distinct word
    path inside scope.paths           ->  +12 each (a file read or edited,
                                           --paths, or a path in the prompt)
    words and paths together under 4  ->   count as 0: no match
    state 'contested'                 ->   +3, added after that floor
    score 0                           -> not retrieved, unless the claim is
                                           universal or shares a conflictsWith
                                           component with a claim that is

**A ledger may be stricter than this table.** Read `matching` in its
`context/ledger.config.json` before choosing topics. With `"minScore": 8`,
one topic word is not a match: a prompt must reach 8, with two words from
the claim's title, topics or entities (4 + 4), with one of those and two
from its statement (4 + 2 + 2), or with four from its statement when
`topicWord` is not set. Aim for two topic words; do not count on the
statement. With `"topicWord": true`, at least one shared word must be in the
title, the topics or the entities: words in the statement add to the score
and cannot find the claim alone, however many there are. With
`"detailWords": false`, words in `detail` add nothing, and what this skill
says elsewhere about `detail` being matched like the statement does not hold
in that ledger. With `"perPrompt": 5`, a prompt gets its five best claims
and no more: the sixth is dropped, not listed by title, so a claim must
outscore its neighbours on its own prompt.

The four settings decide only which claims a prompt's words choose.
Universal claims, contested claims (their +3 is still enough with no match),
claims matched by a path, and the other side of a `conflictsWith` pair
arrive as described below and come on top of the five. `route` and
`evaluate.mjs` apply the same setting, so the checks under "Prove it" tell
you the truth either way.

A word counts once however many times it appears: a word in both the title and
the topics is one +4, and a word in the title and the statement is +4, not +6.
An entry in `scope.paths` is a folder (`db/migrations`) or one file; a file
matches itself and a folder matches every file under it. A path written in a
prompt matches the same way, and may be absolute or only the tail
(`jobs/reminders.js`, `reminders.js`); `@src/x.js` and `src/x.js:42` are read
as `src/x.js`. In a prompt it must end in a file name with an extension or
exist in the project: `client/server` in a sentence is not a path. Filler
words never count; the list is `stopWords` in
`src/ledger.mjs` (about a hundred words such as "the", "that", "every";
"read", "file" and "test" are not on it).
Punctuation at the edge of a word is ignored.

Claims are admitted in two tiers. **Universal claims and anything sharing a
`conflictsWith` component with them go first**, regardless of score — that is
what `universal` buys. Everything else competes on score. Within the mandatory
tier, overflow drops by lowest **severity** first; within the scoped tier, by
lowest **score**. Ties break on id. That order is also who gets the room in
the message: a low score is the first to arrive as a title.

When each kind of claim reaches a session:

    universal or contested -> when the session starts, and at the start of
                              every subagent
    matched by words       -> with the prompt that matches
    matched by a path      -> next to the first read or edit of a file under
                              that path (the PostToolUse hook), or with a
                              prompt that spells the path out

Each claim is sent whole **once** per conversation. After that, a prompt that
matches it gets one line naming it. A compaction or a clear starts over, and
so does a change to the claim: edit its statement or contest it in the middle
of a session and the new wording is sent, marked as changed. Supersede it and
the conversation is told once that it is no longer in force, with the claim
that replaced it. A subagent is a conversation of its own: it starts with the universal and
contested claims whole, and what it is sent is not counted as sent to the main
session, or the other way round. A subagent that opens a file gets that
file's claim whole even when the main session already has it, and the main
session gets it whole the first time it opens the file itself.

A claim that arrived only as a title is not counted as sent: the next prompt
or file that matches it tries again to send it whole. A contested claim that
a prompt does not match is not announced again on later prompts; one the
prompt does match gets the one-line pointer like any other. With no match its
score is 3, the lowest there is, so in a crowded message it is the first to
shrink to a title; at the start of a session it competes only with the
universal claims.

Five rules follow, in order of how much they matter:

1. **Put the words a prompt will use in `title` and `topics`.** One word there
   is a match (two in a ledger whose config sets `"minScore": 8`, see
   above). One word that appears only in the statement is not: it takes
   two different words. List the singular and the plural, since `reminders` does not match
   `reminder`, and the verb forms a prompt would use (`emit`, `emitting`).
2. **Scope a claim about files with `scope.paths`, and give it words too.** A
   path is the strongest match there is, and it fires when the agent opens the
   file. That can be after a prompt has already set the direction, and it does
   not fire at all in a project whose `settings.json` lacks the `PostToolUse`
   entry. Words in the topics cover the prompt; the path covers the file.
3. **Add local-language terms beside the English ones** in `topics`, if the
   operator prompts in more than one language. A prompt in the other language
   scores zero against English-only topics.
4. **Tokens of 2 characters or fewer are discarded entirely.** `db`, `ui`, `s3`
   do nothing. Spell them out somewhere in the claim.
5. **`universal: true` is expensive — default to `false`.** A universal claim
   opens every session and every subagent, whole, and takes its room before
   any claim the prompt actually asked for. Reserve it for rules that are
   wrong to ever act without, and reach for `scope.paths` first.

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

Then confirm retrieval directly, **without `--paths`**, because a prompt
arrives before any file is opened:

```bash
cd <project>/tools/context-ledger
node src/cli.mjs route --prompt "add a notes column to the bookings table" --format markdown
```

Read the output for two things. The claim must be there, and it must be there
**whole**: under its own heading with its statement, not in the list headed
"Also matched, by title only". If it is missing, the scope is wrong. Fix the
scope, not the scenario; a scenario that passes only because of its `paths`
means the claim waits for a file to be opened. If it is there by title only,
it lost the room to claims that scored higher or it is too long: shorten the
statement, or give it the topic words that make it score.

Then route one prompt that has nothing to do with the claim. The answer should
be `No claim routed for this prompt.`, or at least not this claim. A claim
that comes back for unrelated prompts has topics that are too general.

`node src/evaluate.mjs` runs every scenario. `correctnessFailures` must be
empty. `expectedByTitleOnly` lists scenarios whose claim was chosen and did
not fit; it does not fail the run, and each entry is a claim some session will
not read.

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
claims still route, and score **+3**, which is enough with no match at all: a
contested claim is sent at the start of every session beside the universal
ones. The point is to get the disagreement in front of the next session rather
than to hide the claim. Bring it to the operator; resolving it is a ruling,
not a cleanup.

### an open question — nobody has decided yet

Record it, so an agent does not settle it by accident: `"kind": "conflict"`,
`"state": "contested"`, and a statement that says what is undecided and what
to do in the meantime. It opens every session until it is closed.

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
  (24 claims, the most one routing returns). **Demote a universal claim to a scoped one; do not raise the budget as a
  reflex.** Every universal claim is paid for at the start of every session.
- `history-state` — the last history entry disagrees with `state`.
- `lifecycle` — an illegal transition; check the table above.
- `single-value-conflict` — two active claims share a `singleValueKey` and one
  of them is `enforced`.
- `broken-scenario-reference` — a scenario names a claim id that does not exist.

Two warnings do not fail the run and should not be left standing:

- `standing-overflow` — the universal and contested claims no longer fit one
  message, so some rule marked "always" starts every session as a title.
  Shorten those statements or demote a universal flag.
- `long-statement` — a statement is over 3,000 characters and will usually
  arrive as a title. Keep the trigger, the symptom and the correction in the
  statement and move the rest to `detail`.

Then, if and only if the ledger is committed in this project (`git
check-ignore -v context/claims.json` prints nothing), stage `context/`
(`context/generated/` included, and a generated `AGENTS.md` if the project
has one) with the work it came from.

## check — is the ledger still honest?

Run periodically, and at session close:

```bash
cd <project>/tools/context-ledger
node src/cli.mjs validate
node src/cli.mjs check-stale      # claims whose evidence anchors have drifted
node src/cli.mjs dashboard        # authority, attention, evidence health
node src/evaluate.mjs             # every scenario still retrieves its claims,
                                  # and which of them would arrive as a title
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

**The hook fails open and silent by design.** A broken hook prints nothing, and
so does a working one when a prompt matches no claim. The sign of life is the
block that opens a session, headed `# <project> routed context`. If a session
starts without it, run `node src/cli.mjs validate`: malformed JSON in
`context/` silences the hook, and nothing will tell you.

**A claim you were given earlier is not sent again.** When a prompt's context
says `Given earlier in this session and relevant again: CLM-...`, the rule is
further up the conversation. If you cannot find it, read it:
`node tools/context-ledger/src/cli.mjs expand --claim <id>`, from the project
root (the hook prints the command in that form; a shared ledger's message
prints its own, with a full path, and that is the one to run for its
claims). The same command reads any
claim listed by title only. The hook itself needs no installed packages;
the CLI does, and fails loudly without `tools/context-ledger/node_modules`.

**`build-index --check` compares bytes.** On Windows with `core.autocrlf`, git
materialises LF-written files as CRLF and the check reports drift on identical
content. Pin the ledger's paths `text eol=lf` in `.gitattributes`; if a new
project reports impossible drift, that is the cause.

**Generated views are derived.** Never hand-edit `context/generated/` or a
generated `AGENTS.md` — `build-index` overwrites them. The `AGENTS.md` view is
opt-in and only emitted when the project supplies
`context/templates/AGENTS.md.tmpl`.
