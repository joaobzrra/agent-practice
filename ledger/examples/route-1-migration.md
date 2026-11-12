# Tablebook routed context

## Binding invariants
- [CLM-customer-copy-spanish] (accepted, user) Everything a customer or a restaurant reads (pages, emails, error messages, SMS) is written in Spanish. Code, comments, commit messages and logs are English. Decided by the owner; do not translate customer copy into English to match the code.

## Current verified facts
- [CLM-bookings-table-lock] (verified, session) The `bookings` table is read by every page load and by the nightly reporting job. A bare `ALTER TABLE bookings` waits behind any long read, and every new read then queues behind the ALTER, so the site hangs until it finishes. Run schema changes on `bookings` with `SET lock_timeout = '3s'` and retry, never inside the reporting window (02:00 to 03:00). [+detail]

[+detail] means the ledger holds the evidence and background of that claim: `node tools/context-ledger/src/cli.mjs expand --claim <id>`

## Also matched, by title only
These did not fit in this message. Before acting in one's area, read it whole: `node tools/context-ledger/src/cli.mjs expand --claim <id>`
- [CLM-waiting-list-not-decided] Whether a waiting-list customer is auto-booked or only notified is undecided
