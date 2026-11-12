# Current context state

Generated. Do not edit by hand.

- **CLM-bookings-table-lock** (verified, session): The `bookings` table is read by every page load and by the nightly reporting job. A bare `ALTER TABLE bookings` waits behind any long read, and every new read then queues behind the ALTER, so the site hangs until it finishes. Run schema changes on `bookings` with `SET lock_timeout = '3s'` and retry, never inside the reporting window (02:00 to 03:00).
- **CLM-customer-copy-spanish** (accepted, user): Everything a customer or a restaurant reads (pages, emails, error messages, SMS) is written in Spanish. Code, comments, commit messages and logs are English. Decided by the owner; do not translate customer copy into English to match the code.
- **CLM-reminder-emails-idempotent** (enforced, implementation): The reminder job may run twice for the same hour after a restart. It must never send a second reminder: it records `reminder_sent_at` on the booking in the same transaction that queues the email, and skips any booking where that column is set. A change to `src/jobs/reminders.ts` that queues before recording brings back the duplicate emails customers complained about in February.
- **CLM-waiting-list-not-decided** (contested, session): When a table frees up, the waiting list could book the first customer automatically or only notify them. The owner has not chosen. Do not implement either as the default; build the notification path only and ask before adding automatic booking.
