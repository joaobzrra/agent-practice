# A green deploy hid a migration that never ran

## What happened

A deploy script finished with every check green: the container was healthy,
the home page rendered, the login page rendered, and the protected page
redirected visitors who were not signed in.

The database migration (the script that adds the new column) had not run.

In that app, migrations run the first time anything opens the database. None of
the checks opened it. The home and login pages read no data. The protected page
decided to redirect by looking only at whether a session cookie existed, before
any code asked who the user was.

The first real user to sign in would have met "no such column".

## Why it happens

A health check proves the code paths it touches and nothing else. Green means
"these requests worked", not "the release works".

## The rule

- After any deploy that changes the database schema, force one real database
  read, then read the schema back and confirm the migration is recorded.
- Never report a migration as applied on the strength of a green deploy.
- A request with an invalid session cookie is a cheap way to do it: it passes
  the cookie-presence check, reaches the code that opens the database, and is
  then redirected. No account is needed.

```
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: session=x" https://your-app.example/protected
```

- Then teach the smoke test to do this itself, so nobody has to remember.
