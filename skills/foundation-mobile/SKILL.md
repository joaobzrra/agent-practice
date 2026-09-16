---
name: foundation-mobile
description: "Kickoff/major-subsystem foundation protocol for iOS/Android apps (native or cross-platform): secure storage, offline model, store rules, docs/FOUNDATION.md, day-one enforcement."
---

# Foundation — Mobile

## Why this exists

Mobile apps fail at the foundation in predictable ways: tokens kept in plain preferences, an API designed for a browser that drains the battery on a phone, no offline story so every flaky connection is a bug, store guidelines discovered at submission, no crash reporting until the 1-star reviews arrive. The operator wants AAA results — secure by default, fast on real mid-range devices, and finished. This skill forces the decisions early, writes them into the repo so later sessions inherit them, and sets up enforcement on day one.

Operating rules while this skill is active:

- Do not shrink the job to save tokens or time. Correctness, security and performance beat brevity. Use plan mode for anything non-trivial and spawn a reviewer subagent for the adversarial pass if available.
- Ask only what is undecided. Read first, then interview; 3 rounds of 3–4 sharp questions, not a form.
- Push back on weak answers ("we'll handle offline later", "just store the token in prefs"). the operator prefers stress-tested arguments over validation.
- Every decision must be decidable and written. "Secure storage" is not a decision. "Refresh token in Keychain/Keystore with device-only accessibility; access token in memory; 15-minute access TTL; logout wipes both" is.

## Step 0 — Read before asking

Gather what exists: the repo (including uncommitted working tree), `CLAUDE.md`, `docs/FOUNDATION.md`, project files (Xcode/Gradle/`pubspec`/`package.json`), lockfiles, CI config, README, backend contract if any, and anything the operator pasted. Decide scope:

- **Kickoff**: no `docs/FOUNDATION.md` (or empty repo). Full protocol, create the document.
- **Subsystem**: `docs/FOUNDATION.md` exists. Read it, honor its decisions, run the protocol only for the new subsystem, append a `## Subsystem: <name>` section.

Summarize in 5–10 lines what is known and what is undecided.

If the project spans domains (a game with a companion website or app), run the matching foundation skill for each part but keep a single `docs/FOUNDATION.md` with one section per part.

## Step 1 — Interview (AskUserQuestion)

Use AskUserQuestion, 2–4 questions per round, recommended option first, one line on why it matters. Skip what Step 0 answered. Order matters.

**Purpose and scope**
- One-sentence purpose and the metric that says it worked (retention, task completion, orders).
- Non-goals for v1.
- Users, and the worst thing a malicious user or a stolen phone could do with this app. (Seeds the threat model.)

**Platform**
- iOS / Android / both; minimum OS versions (decide from the real audience's devices, not the newest phone); tablet support.
- Native vs cross-platform, with the reason (team, performance need, native-feature depth, code sharing with an existing web app). Pin framework and toolchain versions.
- Reference low-end device for budgets (e.g. a 4 GB RAM Android from ~4 years ago).

**Identity, data, and trust**
- Auth: managed provider / own backend / social; session model with refresh tokens; where each token lives (Keychain / Keystore only); biometric unlock; what happens on logout and on device change.
- Data stored on device: what, how sensitive, encrypted at rest or not, wiped on logout; LGPD/GDPR basis, privacy nutrition labels and Data Safety form need this inventory.
- Offline strategy: online-only (explicit) / read cache / offline-first with sync. If sync: conflict rule, queue durability, idempotent writes.
- Backend and API contract: who owns it, versioning, how breaking changes are rolled out to old app versions still in the wild (forced-update mechanism).
- Payments: IAP (store rules apply for digital goods) vs external PSP (physical goods/services); never handle card data.
- Permissions: the minimal set, requested in context with a rationale; what the app does when denied.

**Platform features and operations**
- Push notifications (provider, token lifecycle, quiet hours), deep links / universal links, background tasks, camera/location/files.
- Crash reporting and analytics: which, opt-in/opt-out, no PII in events.
- Release: CI with signing (fastlane or equivalent), TestFlight / Play internal track, staged rollout, rollback plan, versioning scheme.
- Accessibility target (VoiceOver/TalkBack, dynamic type, contrast) and localization from day one or not.

**Budgets**
- Cold start ≤ 2s on the reference device, screen transitions ≤ 300ms, frame drops < 1% in lists, app size ceiling, battery impact (no continuous location/background polling without a stated need), data usage on cellular. Defaults if the operator has none: cold start ≤ 2s, download size ≤ 50 MB, p95 API ≤ 500ms on 4G.

## Step 2 — Adversarial pass

Attack the plan before writing it down. Produce 5–10 findings covering:

- Stolen or shared device: what is readable from the app's storage, backups (iCloud/Android auto-backup can leak data — decide the exclusion), screenshots in the recent-apps preview, clipboard.
- Network: TLS only, certificate pinning decision (with a rotation plan, or explicitly rejected), what a proxying attacker can replay, WebView content and JS bridges.
- Reverse engineering: no secrets in the bundle (API keys that must ship are rate-limited and scoped), obfuscation stance, root/jailbreak policy for sensitive apps.
- Offline and flaky network: every write path on a 2-second timeout, retries and duplicate submissions, sync conflicts, the queue surviving an app kill.
- Store rejection: IAP rules, privacy labels, account deletion in-app (required by both stores), login-with-Apple requirement when using social login, permission rationale strings.
- Fragmentation: which OS version or OEM (Xiaomi/Samsung background restrictions) breaks push or background sync?
- Upgrade path: a user on a 6-month-old build hits a breaking API — what do they see?

Present findings to the operator, revise decisions with them, then write.

## Step 3 — Write `docs/FOUNDATION.md`

Write in the language the operator is using in the conversation. Use this structure; decisions, not intentions. For a subsystem, append a `## Subsystem: <name>` section with the same subsections in miniature.

```markdown
# Foundation — <app>
Last updated: <date> · Scope: kickoff | subsystem

## Purpose & success metric
## Non-goals (v1)
## Platforms, minimum versions & reference device
## Users & trust boundaries
## Architecture decisions
| Decision | Choice | Why | Alternatives rejected | Revisit when |
Include: native/cross-platform, state management, networking layer, persistence, offline/sync model, navigation/deep links.
## Data & privacy
On-device data inventory, encryption, backup exclusions, retention, deletion path, LGPD basis, store privacy declarations.
## Security model
| Asset | Threat | Mitigation | Status |
Plus fixed controls: token storage, TLS/pinning stance, secrets policy, WebView rules, root/jailbreak stance, permission policy.
## Performance budgets
Numbers + how measured (reference device, profiler, CI perf test).
## Quality gates
Automated vs reviewed.
## Release & operations
Signing, CI, tracks, staged rollout, forced-update mechanism, crash reporting, analytics.
## Open risks
```

Then add to `CLAUDE.md` (create if missing):

```
## Foundation
Read docs/FOUNDATION.md before architectural, security, data, offline/sync or performance work. Its decisions are binding; propose changes there rather than diverging in code.
```

## Step 4 — Day-one enforcement

Set up what is checkable now, adapted to the stack:

- Strictness: Swift strict concurrency / Kotlin explicit API + warnings as errors / TypeScript `strict` / Dart analyzer strict; lint (SwiftLint, detekt/ktlint, ESLint, `flutter analyze`) in a pre-commit hook.
- Secrets: no keys in source; local config ignored, example committed; secret scanning (gitleaks or equivalent) in pre-commit and CI.
- Dependencies: lockfiles committed, vulnerability audit in CI (`npm audit`, OWASP dependency-check, `pub outdated`), Renovate/Dependabot enabled.
- Tests: unit runner with one real domain test; one UI/integration smoke test of the critical path on both platforms in CI (simulator/emulator).
- Security baseline: secure-storage wrapper implemented once and used everywhere; cleartext traffic disabled (`NSAppTransportSecurity` default, Android `usesCleartextTraffic=false`); backup exclusions configured; a MASVS-L1 checklist file in `docs/` with each item marked.
- Performance: a startup-time measurement in CI or a documented manual capture on the reference device; list rendering test with 1,000 items.
- Release: CI builds signed artifacts for both stores from main; version bump script; crash reporting SDK wired and verified with a test crash in a debug build.

Anything that can't be set up now goes under Open risks with an owner.

## Step 5 — Handoff

The foundation is done when: FOUNDATION.md has no empty sections, CLAUDE.md points to it, enforcement is committed or listed as a risk, and the operator has confirmed the decisions. Do not start feature code inside this skill. End by proposing the first implementation plan (plan mode), starting with the riskiest decision — usually auth/session or the offline model — so it gets validated first.