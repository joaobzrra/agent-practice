---
name: foundation-web
description: "Kickoff/major-subsystem foundation protocol for websites, web apps, storefronts (headless commerce platforms) and APIs: interview, adversarial pass, docs/FOUNDATION.md, day-one enforcement."
---

# Foundation — Web

## Why this exists

The operator builds for real users and wants AAA results: secure by default, fast, and finished — not a prototype that looks done. The common failure is not bad code, it's decisions that were never made: auth chosen by accident, PII stored without a retention rule, performance never budgeted, no gate enforcing any of it. This skill forces those decisions early, writes them down in the repo so every later session inherits them, and sets up enforcement on day one so quality doesn't depend on anyone remembering.

Operating rules while this skill is active:

- Do not shrink the job to save tokens or time. Correctness, security and performance beat brevity. Use plan mode for anything non-trivial and spawn a reviewer subagent for the adversarial pass if available.
- Ask only what is undecided. Read first, then interview. A 40-question form produces default answers; 3 rounds of 3–4 sharp questions produce decisions.
- Push back. If an answer is weak ("we'll add auth later", "performance is fine"), say why it's a problem now and propose the stronger default. the operator prefers stress-tested arguments over validation.
- Every decision must be decidable and written. "Consider security" is not a decision. "Sessions: httpOnly SameSite=Lax cookies, 7-day sliding expiry, rotated on privilege change" is.

## Step 0 — Read before asking

Before any question, gather what already exists: the repo (including uncommitted working tree), `CLAUDE.md`, `docs/FOUNDATION.md`, `package.json`/lockfile, existing CI, `.env.example`, README, and anything the operator pasted. Then decide the scope:

- **Kickoff**: no `docs/FOUNDATION.md` (or repo is empty). Run the full protocol and create the document.
- **Subsystem**: `docs/FOUNDATION.md` exists. Read it, honor its decisions, and run the protocol only for the new subsystem; append a `## Subsystem: <name>` section instead of rewriting.

Summarize in 5–10 lines what you learned and what is still undecided. That list drives the interview.

If the project spans domains (a storefront plus a mobile app, a game with a companion site), run the matching foundation skill for each part but keep a single `docs/FOUNDATION.md` with one section per part.

## Step 1 — Interview (AskUserQuestion)

Use the AskUserQuestion tool, 2–4 questions per round, each with a recommended option first and one line on why it matters. Skip anything already answered by Step 0. Cover these areas, in this order — later answers depend on earlier ones:

**Purpose and scope**
- One-sentence purpose and the single metric that says it worked (conversion, signups, task time, revenue).
- Explicit non-goals for v1. Non-goals are what keep the foundation from being half of five things.
- Who are the users, and what is the worst thing a malicious user could do with this system? (This seeds the threat model.)

**Platform and rendering**
- Framework and rendering strategy (SSR / SSG / SPA / hybrid), chosen by SEO need and interactivity, not habit. Public content that must rank → SSR/SSG. Logged-in tool → SPA or hybrid is fine.
- Hosting/deploy target and environments (dev/staging/prod). If on a headless commerce platform: managed runtime vs legacy, platform-hosted storefront vs a custom headless frontend, which parts live in platform apps vs external services.
- Browser and device support floor; mobile-first or not.

**Identity, data, and trust**
- Auth: none / own credentials / OAuth-social / SSO / managed provider. Session model (cookie vs token), password policy, MFA, account recovery. Recommend a managed provider unless there's a concrete reason to own it.
- Authorization model (roles, ownership, tenants). Where is it enforced — must be server-side at the data boundary, never only in the UI.
- Data inventory: what is stored, which fields are PII, retention period, who can export/delete. LGPD applies to Brazilian users: consent basis, privacy notice, deletion path.
- Payments: none / PSP-hosted checkout / own integration. Never handle raw card data; PCI scope must stay with the PSP.
- File uploads: allowed types, size limits, where stored, virus/type validation, served from a separate origin.

**Integration and operations**
- External services and the one dependency you'd regret (lock-in, cost, single point of failure). Decide the exit plan now.
- Observability: error tracking, structured logs (no PII), uptime check, alerting owner.
- Backups and restore test cadence for any database.

**Budgets**
- Performance budgets with numbers. Defaults if the operator has none: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 on a mid-range phone over 4G; initial JS ≤ 200 KB gzipped for content pages; API p95 ≤ 300ms.
- Accessibility target: WCAG 2.2 AA unless there's a reason not to.
- Availability target and what happens when a dependency is down (degrade, queue, fail closed).

## Step 2 — Adversarial pass

Before writing anything down, attack the plan. Spend real effort here; this is where "half thought out" gets caught. Produce a short list (5–10 items) covering:

- Abuse cases: credential stuffing, enumeration, IDOR (guessing another user's ID), CSRF, SSRF via any URL the server fetches, XSS via any user-rendered content, mass assignment, rate-limit bypass, webhook spoofing.
- Load: what breaks first at 10× expected traffic? Which query has no index? Which endpoint has no pagination?
- Failure: what does the user see when the PSP / auth provider / CMS is down? Is any operation non-idempotent (double charge, double order)?
- Data: what happens to a deleted user's data in logs, backups, analytics, third parties?
- Supply chain: how many dependencies, who maintains them, is the lockfile committed, is `npm audit` clean?
- Operations: who rotates secrets, how are they stored (never in the repo; `.env` ignored, `.env.example` committed), how does a deploy roll back?

Present the findings to the operator, revise decisions with them, then write.

## Step 3 — Write `docs/FOUNDATION.md`

Write in the language the operator is using in the conversation. Use this structure exactly; every section must contain decisions, not intentions. For a subsystem, append only a `## Subsystem: <name>` section with the same subsections in miniature.

```markdown
# Foundation — <project>
Last updated: <date> · Scope: kickoff | subsystem

## Purpose & success metric
## Non-goals (v1)
## Users & trust boundaries
Who the actors are, what each can do, where the server-side boundary is.
## Architecture decisions
| Decision | Choice | Why | Alternatives rejected | Revisit when |
## Data & privacy
Data inventory, PII fields, retention, deletion path, LGPD basis.
## Security model
| Asset | Threat | Mitigation | Status |
Plus fixed controls: headers/CSP, session model, input validation at the boundary, rate limits, secrets handling, upload rules, dependency policy.
## Performance budgets
Numbers + how each is measured (Lighthouse CI, k6, RUM).
## Quality gates
What is enforced automatically (CI, hooks) vs reviewed by a human.
## Operations
Environments, deploy/rollback, observability, backups, on-call owner.
## Open risks
```

Then add to `CLAUDE.md` (create it if missing):

```
## Foundation
Read docs/FOUNDATION.md before architectural, security, data or performance work. Its decisions are binding; propose changes there rather than diverging in code.
```

## Step 4 — Day-one enforcement

A checklist the model reads is not a gate. Set up what is checkable now, in the same session, adapting to the stack:

- Type safety: TypeScript `strict: true` (or the language's equivalent); no `any` escape hatches without a comment.
- Lint + format: ESLint with a security plugin (`eslint-plugin-security` or framework equivalent), Prettier, run in a pre-commit hook.
- Secrets: `.env` in `.gitignore`, `.env.example` committed, secret scanning in pre-commit (gitleaks or equivalent) and CI.
- Dependencies: lockfile committed, `npm audit` (or `pnpm audit`) in CI failing on high/critical, Renovate or Dependabot enabled.
- Tests: unit test runner wired with one real test; Playwright (or equivalent) with one smoke test of the critical path; both in CI.
- Performance: Lighthouse CI (or equivalent) with the budgets from Step 1 as assertions, running against preview deploys.
- Security headers: CSP (start strict, report-only if needed), HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors — configured at the framework or edge, verified with a test.
- CI: build + lint + test + audit on every PR; deploy only from main; staging before prod.

If any of these can't be set up now, record it under Open risks with an owner, not as a vague "TODO".

## Step 5 — Handoff

The foundation is done when: FOUNDATION.md exists with no empty sections, CLAUDE.md points to it, the enforcement above is committed (or its absence is listed as a risk), and the operator has confirmed the decisions. Do not start feature code inside this skill. End by proposing the first implementation plan (plan mode) derived from the document, starting with the riskiest decision so it gets validated first.