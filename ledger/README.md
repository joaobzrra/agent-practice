# The ledger, worked through once

The ledger is the part of this setup that gets used most. This folder holds
the tool and shows it doing its one job: putting the right two or three
decisions in front of an agent at the moment a prompt arrives, without the
agent asking.

- [`tools/context-ledger/`](tools/context-ledger/README.md) is the tool. Its
  README has the install steps for your own project, the commands and the
  limits.
- `context/` is the ledger of an invented project, a restaurant booking app
  called Tablebook. Its four claims are invented too.
- [`examples/`](examples/) holds three outputs. They are real: each is what the
  tool printed for the prompt shown, copied into a file without editing.

This folder is laid out the way a project that uses the tool is laid out, so
everything below runs here as it is.

## Try it

```
cd ledger/tools/context-ledger
npm install
node src/cli.mjs route --prompt "add a notes column to the bookings table" --paths db/migrations/0042_booking_notes.sql --limit 2 --format markdown
```

That prints the first pack below. `npm run ci` runs the tool's 57 tests and
then checks this ledger.

## How often it runs

Counted from the author's local session logs on 2026-11-12:

| | Transcripts |
|---|---|
| Scanned (subagent transcripts included) | 3,446 |
| Received at least one ledger pack | 1,863 |
| Main sessions scanned | 259 |
| Main sessions that received a pack | 93 |
| Opened any file in the knowledge library | 19 |

Projects with no ledger never get a pack, so the first ratio understates it
for the projects that have one. The last row is there for scale: a store that
is pushed into the session by a hook is used two orders of magnitude more than
one an agent has to remember to open.

## The claims

[`context/claims.json`](context/claims.json) holds four, one of each common
kind:

| Claim | Kind | State | Universal |
|---|---|---|---|
| `CLM-customer-copy-spanish` | invariant | accepted | yes |
| `CLM-bookings-table-lock` | hazard | verified | no |
| `CLM-reminder-emails-idempotent` | invariant | enforced | no |
| `CLM-waiting-list-not-decided` | conflict | contested | no |

A universal claim goes into every pack. The others go in only when they match
the prompt.

## Three prompts, three packs

These three runs call the tool by hand, with the file being edited passed as
`--paths` and the pack budget set to 2 so the selection is visible. The
default budget is 24, and with four claims everything would fit.

**1. "add a notes column to the bookings table"**, editing
`db/migrations/0042_booking_notes.sql`. Output, in full
([`examples/route-1-migration.md`](examples/route-1-migration.md)):

```
# Tablebook routed context

## Binding invariants
- [CLM-customer-copy-spanish] (accepted, user) Everything a customer or a restaurant reads (pages, emails, error messages, SMS) is written in Spanish. Code, comments, commit messages and logs are English. Decided by the owner; do not translate customer copy into English to match the code.

## Current verified facts
- [CLM-bookings-table-lock] (verified, session) The `bookings` table is read by every page load and by the nightly reporting job. A bare `ALTER TABLE bookings` waits behind any long read, and every new read then queues behind the ALTER, so the site hangs until it finishes. Run schema changes on `bookings` with `SET lock_timeout = '3s'` and retry, never inside the reporting window (02:00 to 03:00).

Expand with: `CLM-bookings-table-lock`, `CLM-customer-copy-spanish`
```

The agent was asked for a column. It was not asked about locks, and would not
have known to ask. The hazard arrived anyway, with the fix in it.

**2. "change the wording of the reminder email"**, editing
`src/emails/reminder.tsx`
([`examples/route-2-email.md`](examples/route-2-email.md)): the universal
language rule, plus `CLM-reminder-emails-idempotent`. The table-lock hazard is
not in the pack.

**3. "build the waiting list page"**, editing `src/waiting-list/page.tsx`
([`examples/route-3-waiting-list.md`](examples/route-3-waiting-list.md)): the
universal rule, plus `CLM-waiting-list-not-decided` under "Open conflicts".
The agent is told the owner has not chosen between two behaviours, before it
picks one and builds it.

Same ledger, three prompts, three different packs. That is the whole
mechanism.

## What a live session gets

The runs above pass a file path. The hook that runs in a live session does
not: it has the prompt text and nothing else. Called with the same three kinds
of prompt against this ledger, the real hook returned:

| Prompt | Claims injected |
|---|---|
| "add a notes column to the bookings table" | all four |
| "do it" | the universal rule and the contested question |
| "edit db/migrations/0042_booking_notes.sql" | the universal rule and the contested question |

Three things follow, and they matter more than the tidy runs above:

- **With four claims and a budget of 24, almost any real prompt gets
  everything.** The first prompt shares a word with every claim ("the" is
  enough). A ledger starts selecting only when it is bigger than the budget.
- **Naming the file does not retrieve the hazard.** The third prompt names the
  migration and the table-lock claim is not returned, because the hook scores
  words and the claim's `scope.paths` is not compared with anything.
- **A contested claim is always injected**, whatever the prompt says.

## What to notice in the claims

- **The statement carries the trigger, the symptom and the correction.** A
  future session reads only that sentence. "Be careful with migrations" would
  have routed just as well and helped nobody.
- **A good match can still lose.** With the budget at 2 and no path, prompt 1
  returns the waiting-list question instead of the table-lock hazard. The
  hazard matched three of the prompt's words (`bookings`, `table`, `the`) for
  6 points. The waiting-list question matched two (`table`, `the`) for 4, and
  got 3 more for being contested: 7. One of those matches is the word "the".
  Word scores are small and blunt, so the margin between the right claim and
  the wrong one is often a single point.
- **So test retrieval, do not assume it.** Write the claim, then route the
  prompt you expect a future session to type, without `--paths`, and look at
  what comes back. The skill's "Prove it, don't hope" section is this step.
- **An undecided question is a claim too.** Recording it as `contested` is what
  stops an agent from settling it by accident.
- **Universal is expensive.** Every universal claim is in every pack, so there
  is one here, and it is a rule that applies to almost any file.

## Where the method is written down

[`../skills/ledger/SKILL.md`](../skills/ledger/SKILL.md) is the skill an agent
follows: when to write a claim, the full claim shape, how to supersede or
contest one, and the gates to run afterwards.
