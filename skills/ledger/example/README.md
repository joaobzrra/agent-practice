# The ledger, worked through once

The ledger is the part of this setup that gets used most. This folder shows it
doing its one job: putting the right two or three decisions in front of an
agent at the moment a prompt arrives, without the agent asking.

The project here, a restaurant booking app called Tablebook, is invented. So
are its four claims. The three outputs are real: each is what the ledger tool
printed for the prompt shown, copied into a file without editing.

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

[`claims.json`](claims.json) holds four, one of each common kind:

| Claim | Kind | State | Universal |
|---|---|---|---|
| `CLM-customer-copy-spanish` | invariant | accepted | yes |
| `CLM-bookings-table-lock` | hazard | verified | no |
| `CLM-reminder-emails-idempotent` | invariant | enforced | no |
| `CLM-waiting-list-not-decided` | conflict | contested | no |

A universal claim goes into every pack. The others go in only when their
topics, paths or entities match the prompt or the files in play.

## Three prompts, three packs

The pack budget is set to 2 here so the selection is visible. The tool's
default is 24, and with four claims everything would fit.

**1. "add a notes column to the bookings table"**, editing
`db/migrations/0042_booking_notes.sql`. Output, in full
([`route-1-migration.md`](route-1-migration.md)):

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
([`route-2-email.md`](route-2-email.md)): the universal language rule, plus
`CLM-reminder-emails-idempotent`. The table-lock hazard is not in the pack.

**3. "build the waiting list page"**, editing `src/waiting-list/page.tsx`
([`route-3-waiting-list.md`](route-3-waiting-list.md)): the universal rule,
plus `CLM-waiting-list-not-decided` under "Open conflicts". The agent is told
the owner has not chosen between two behaviours, before it picks one and
builds it.

Same ledger, three prompts, three different packs. That is the whole
mechanism.

## What to notice in the claims

- **The statement carries the trigger, the symptom and the correction.** A
  future session reads only that sentence. "Be careful with migrations" would
  have routed just as well and helped nobody.
- **The path did the work, and the topics alone would have failed.** Run
  prompt 1 again without the file path and the tool returns the waiting-list
  conflict instead of the table-lock hazard. The prompt says "add a notes
  column", and the claim's topics are `migration`, `schema`, `alter`, `lock`:
  the author's words, not the words of someone asking for a column. With the
  path `db/migrations/...` alone and a prompt of "do it", the hazard is
  selected. Both runs were made with the real tool.
- **So test retrieval, do not assume it.** Write the claim, then route the
  prompt you expect a future session to type, and look at what comes back.
  The skill's "Prove it, don't hope" section is this step.
- **An undecided question is a claim too.** Recording it as `contested` is what
  stops an agent from settling it by accident.
- **Universal is expensive.** Every universal claim is in every pack, so there
  is one here, and it is a rule that applies to almost any file.

## What is not here

The tool itself. The package that validates the claims, scores them and
injects the pack from a hook is not published in this repository.
[`../SKILL.md`](../SKILL.md) documents its method: the claim schema, how a
claim is scored, the gates. This folder shows the input and the output.
