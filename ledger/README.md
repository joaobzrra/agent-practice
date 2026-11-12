# The ledger, worked through once

The ledger is the part of this setup that gets used most. This folder holds
the tool and shows it doing its one job: putting the right two or three
decisions in front of an agent at the moment they matter, without the agent
asking.

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

That prints the first pack below. `npm run ci` runs the tool's 113 tests and
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

## What those logs also showed

The same logs held a second number, and it changed the tool.

Claude Code caps what a hook may add to a conversation at 10,000 characters.
A longer message is saved to a file, and the agent is shown the file's path
and the first 2,000 characters. Nothing tells it to open the file.

| | Count |
|---|---|
| Ledger packs sent by the hook | 4,567 |
| Replaced by a path and a 2,000-character preview | 4,092 (90%) |
| Times an agent then opened the saved file | 39 |

For three months the tool routed the right claims and nine times out of ten
the agent received the top of a list. Every retrieval test passed throughout,
because the tests checked which claims were chosen and never what arrived.

Three things in the tool exist because of that table:

- **A pack is built to fit.** Whole statements go in, most relevant first,
  until 9,000 characters are used. A claim that does not fit is listed by its
  title with the command to read it. Nothing is cut in the middle.
- **Nothing is sent whole twice.** The hook records which claims a
  conversation already holds. A later prompt on the same subject gets one line
  naming them. A compaction or a clear empties the conversation, so the record
  is emptied with it.
- **One shared word is not a match.** A word found only in a claim's statement
  has to be joined by a second one. Filler words ("the", "that", "would")
  never count.

Measured on five real ledgers before and after, with the scenarios their
owners had already written:

| | Before | After |
|---|---|---|
| Prompt packs over the cap | 211 of 230 | 0 of 230 |
| Expected claims the agent reads whole | 33 of 262 | 241 of 262 |
| Scenarios whose expected claims are routed | 230 of 230 | 230 of 230 |

The last row is the old test. It was green before and it is green now, which
is the point: it could not see the problem.

## The claims

[`context/claims.json`](context/claims.json) holds four, one of each common
kind:

| Claim | Kind | State | Universal |
|---|---|---|---|
| `CLM-customer-copy-spanish` | invariant | accepted | yes |
| `CLM-bookings-table-lock` | hazard | verified | no |
| `CLM-reminder-emails-idempotent` | invariant | enforced | no |
| `CLM-waiting-list-not-decided` | conflict | contested | no |

A universal claim and an open question are sent when a session starts. The
others are sent when a prompt or a file calls for them.

## Three prompts, three packs

These three runs call the tool by hand, with the file being edited passed as
`--paths` and the pack limited to 2 claims so the selection is visible. The
default limit is 24, and with four claims everything would fit.

**1. "add a notes column to the bookings table"**, editing
`db/migrations/0042_booking_notes.sql`. Output, in full
([`examples/route-1-migration.md`](examples/route-1-migration.md)):

```
# Tablebook routed context

## Binding invariants
- [CLM-customer-copy-spanish] (accepted, user) Everything a customer or a restaurant reads (pages, emails, error messages, SMS) is written in Spanish. Code, comments, commit messages and logs are English. Decided by the owner; do not translate customer copy into English to match the code.

## Current verified facts
- [CLM-bookings-table-lock] (verified, session) The `bookings` table is read by every page load and by the nightly reporting job. A bare `ALTER TABLE bookings` waits behind any long read, and every new read then queues behind the ALTER, so the site hangs until it finishes. Run schema changes on `bookings` with `SET lock_timeout = '3s'` and retry, never inside the reporting window (02:00 to 03:00). [+detail]

[+detail] means the ledger holds the evidence and background of that claim: `node tools/context-ledger/src/cli.mjs expand --claim <id>`

## Also matched, by title only
These did not fit in this message. Before acting in one's area, read it whole: `node tools/context-ledger/src/cli.mjs expand --claim <id>`
- [CLM-waiting-list-not-decided] Whether a waiting-list customer is auto-booked or only notified is undecided
```

The agent was asked for a column. It was not asked about locks, and would not
have known to ask. The hazard arrived anyway, with the fix in it.

The last block is the limit of 2 at work. The open question would have been
the third claim, so it is named by its title with the command that prints it.
A claim that is chosen and does not fit is never left out without a word.

**2. "change the wording of the reminder email"**, editing
`src/emails/reminder.tsx`
([`examples/route-2-email.md`](examples/route-2-email.md)): the universal
language rule, plus `CLM-reminder-emails-idempotent`. The table-lock hazard is
not in the pack, and the open question is again named by title.

**3. "build the waiting list page"**, editing `src/waiting-list/page.tsx`
([`examples/route-3-waiting-list.md`](examples/route-3-waiting-list.md)): the
universal rule, plus `CLM-waiting-list-not-decided` under "Open conflicts".
The agent is told the owner has not chosen between two behaviours, before it
picks one and builds it. The table-lock hazard is named by title here, for a
plain reason: its title says "every page that reads it" and the prompt says
"page". Retrieval matches words, not meaning.

Same ledger, three prompts, three different packs.

## What a live session gets

`route` prints everything that was chosen. A session is sent less, because the
hook leaves out what the conversation already holds. This is one session
against this ledger, event by event, with what the real hook returned:

| Event | Sent |
|---|---|
| The session starts | The universal rule and the open question, whole. A line saying the ledger holds four claims. |
| "add a notes column to the bookings table" | `CLM-bookings-table-lock`, whole. Not the universal rule again. |
| "do it" | Nothing. |
| "now the same for the tables table" | One line: `Given earlier in this session and relevant again: CLM-bookings-table-lock` |
| The agent reads `src/jobs/reminders.ts` | `CLM-reminder-emails-idempotent`, whole, next to the file's content. No prompt had mentioned reminders. |
| The agent reads that file again | Nothing. |

The fifth row is the one a prompt-only hook cannot do. The claim is scoped to
that file (`scope.paths`), and the hook that runs after a file is read or
edited is the only one that knows which file is in play.

## What to notice in the claims

- **The statement carries the trigger, the symptom and the correction.** A
  future session reads only that sentence. "Be careful with migrations" would
  have routed just as well and helped nobody.
- **The statement is short.** Each of these is under 450 characters. Twenty
  claims of 400 characters fit one message whole, seventeen of 450, thirteen
  of 600. A statement of 3,000 characters takes a third of
  the room and will often arrive as a title. `validate` warns about those.
- **The evidence has its own field.** `CLM-bookings-table-lock` carries a
  `detail`: when the problem was found and what was measured. The hook sends
  the statement, marks it `[+detail]`, and leaves the rest one command away.
  Words in the detail still count when a prompt is matched.
- **The words a prompt will use are in the title and topics.** A word there
  counts double and is enough alone. A word buried in the statement needs
  company.
- **Test what arrives, not only what is chosen.** Write the claim, route the
  prompt you expect a future session to type, and read the output. Then run
  `node src/evaluate.mjs`: `expectedByTitleOnly` lists every scenario whose
  claim was chosen and still did not fit. The skill's "Prove it, don't hope"
  section is this step.
- **An undecided question is a claim too.** Recording it as `contested` is what
  stops an agent from settling it by accident.
- **Universal is expensive.** Every universal claim opens every session and
  every subagent, so there is one here, and it is a rule that applies to
  almost any file.

## Where the method is written down

[`../skills/ledger/SKILL.md`](../skills/ledger/SKILL.md) is the skill an agent
follows: when to write a claim, the full claim shape, how to supersede or
contest one, and the gates to run afterwards.
