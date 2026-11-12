# Where this skill comes from

This folder is an unmodified copy of Cloudflare's `security-audit` skill.

- Source: https://github.com/cloudflare/security-audit-skill
- Copied from commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (2026-09-14),
  folder `skills/security-audit/`.
- Licence: MIT, Copyright (c) 2025-2026 Cloudflare, Inc. The full text is in
  `LICENSE` in this folder.

It is included because it is the security review procedure this setup uses, not
because it was written here. Nothing in it has been changed.

For the current version, install from the source instead of copying this
folder:

```
npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit
```

## Known limit on Windows

`validate-findings.cjs` refuses to read its input on Windows, with the message
"OS no-follow and nonblocking input protection is unavailable". Seven of its 34
tests fail there for that reason. None of the `validate-coverage-ledger.cjs`
tests fail (24 pass, 7 are skipped). This is how the upstream code behaves; it is not a change made in
this copy.
