# Tablebook routed context

## Binding invariants
- [CLM-customer-copy-spanish] (accepted, user) Everything a customer or a restaurant reads (pages, emails, error messages, SMS) is written in Spanish. Code, comments, commit messages and logs are English. Decided by the owner; do not translate customer copy into English to match the code.

## Open conflicts
- [CLM-waiting-list-not-decided] (contested, session) When a table frees up, the waiting list could book the first customer automatically or only notify them. The owner has not chosen. Do not implement either as the default; build the notification path only and ask before adding automatic booking.

Expand with: `CLM-customer-copy-spanish`, `CLM-waiting-list-not-decided`
