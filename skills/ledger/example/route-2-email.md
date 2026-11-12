# Tablebook routed context

## Binding invariants
- [CLM-customer-copy-spanish] (accepted, user) Everything a customer or a restaurant reads (pages, emails, error messages, SMS) is written in Spanish. Code, comments, commit messages and logs are English. Decided by the owner; do not translate customer copy into English to match the code.
- [CLM-reminder-emails-idempotent] (enforced, implementation) The reminder job may run twice for the same hour after a restart. It must never send a second reminder: it records `reminder_sent_at` on the booking in the same transaction that queues the email, and skips any booking where that column is set. A change to `src/jobs/reminders.ts` that queues before recording brings back the duplicate emails customers complained about in February.

Expand with: `CLM-customer-copy-spanish`, `CLM-reminder-emails-idempotent`
