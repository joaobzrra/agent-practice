---
name: foundation-software
description: "Kickoff/major-subsystem foundation protocol for desktop apps, CLIs, services, libraries and pipelines: interview, adversarial pass, docs/FOUNDATION.md, day-one enforcement."
---

# Foundation — Software

## Why this exists

The operator builds tools they depend on daily, and wants AAA results: secure by default, responsive, correct, and finished. Software projects fail at the foundation in specific ways: the UI thread ends up doing I/O, persistence has no migration story, config and secrets get mixed, errors are swallowed, distribution and updates are an afterthought, and nothing enforces any of it. This skill forces those decisions early, writes them into the repo so later sessions inherit them, and sets up enforcement on day one.

Operating rules while this skill is active:

- Do not shrink the job to save tokens or time. Correctness, security and performance beat brevity. Use plan mode for anything non-trivial and spawn a reviewer subagent for the adversarial pass if available.
- Ask only what is undecided. Read first, then interview. Prefer 3 rounds of 3–4 sharp questions over one long form.
- Push back on weak answers ("we'll add tests later", "it's just for me"). the operator prefers stress-tested arguments over validation. "Just for me" tools grow users; found them properly.
- Every decision must be decidable and written. "Handle errors well" is not a decision. "Errors are typed results at module boundaries; unexpected exceptions crash with a report; the UI never shows a stack trace" is.

## Step 0 — Read before asking

Gather what exists: the repo (including the uncommitted working tree), `CLAUDE.md`, `docs/FOUNDATION.md`, project/solution files, lockfiles, CI config, README, and anything the operator pasted. Then decide the scope:

- **Kickoff**: no `docs/FOUNDATION.md` (or empty repo). Full protocol, create the document.
- **Subsystem**: `docs/FOUNDATION.md` exists. Read it, honor its decisions, run the protocol only for the new subsystem, and append a `## Subsystem: <name>` section.

Summarize in 5–10 lines what is known and what is undecided. That list drives the interview.

If the project spans domains (a game with a companion website, a desktop tool with a web dashboard), run the matching foundation skill for each part but keep a single `docs/FOUNDATION.md` with one section per part.

## Step 1 — Interview (AskUserQuestion)

Use AskUserQuestion, 2–4 questions per round, recommended option first, one line on why it matters. Skip what Step 0 already answered. Order matters — later answers depend on earlier ones.

**Purpose and shape**
- One-sentence purpose and the metric that says it worked (time saved per task, throughput, error rate, adoption).
- Kind of software: desktop GUI / CLI / service / library / pipeline / bot. This decides most of what follows.
- Non-goals for v1.
- Who uses it, with what privileges, and what is the worst thing a malicious input or user could make it do? (Seeds the threat model.)

**Platform and runtime**
- Target OS and versions; language/runtime with a reason (team knowledge, ecosystem, performance need, distribution constraints). For WinUI/.NET work, pin the .NET and Windows App SDK versions.
- Single-process or multi-process; does anything need elevated privileges (avoid unless essential — and then isolate it).
- Offline behavior and what needs network at all.

**Architecture**
- Module boundaries and dependency direction (e.g. domain ← application ← infrastructure/UI). Which layer is allowed to touch the filesystem, network, and OS APIs.
- Concurrency model: what runs on the UI thread, what runs on workers, how cancellation works, how progress is reported. The UI thread does no I/O — ever.
- State and persistence: in-memory / files / SQLite / external DB. Schema versioning and migration from day one, even for "simple" JSON files. Atomic writes (write temp, rename) for anything the user can't afford to lose.
- Configuration vs secrets: config in a documented file with defaults; secrets in the OS credential store (Windows Credential Manager, Keychain, libsecret), never in config or the binary.
- Extension points: plugins/scripts? If yes, decide the trust model now (sandboxed or fully trusted) — it can't be retrofitted.

**Operations and lifecycle**
- Logging: structured, leveled, rotating, no PII by default; where the log lives and how a user sends it to you.
- Error policy: what is recoverable, what crashes, whether crash reports are collected (opt-in) and what they contain.
- Distribution: installer/package format, code signing (unsigned Windows binaries get SmartScreen-blocked; decide the certificate path now), auto-update channel and how updates are verified (signed manifests).
- Telemetry: none / opt-in / opt-out. Default to none or opt-in.
- Licensing or access control, if any.

**Budgets**
- Startup time to interactive, memory ceiling at idle and under load, responsiveness (no UI stall > 100ms), throughput for pipelines/services, binary/installer size. Defaults if the operator has none: cold start ≤ 2s, idle memory ≤ 150 MB for a desktop tool, p95 UI action ≤ 100ms.
- Test strategy: unit for domain logic, integration for persistence and OS boundaries, one end-to-end smoke test of the main workflow.

## Step 2 — Adversarial pass

Attack the plan before writing it down. Produce 5–10 findings covering:

- Input trust: every file path (traversal, symlinks, UNC), every deserialized payload (unsafe deserializers, size bombs), every shell/process invocation (argument injection), every URL fetched (SSRF), every IPC message (who can send it).
- Privilege: does anything run elevated or as a service? Can a low-privilege user influence it (writable config, DLL/plugin search paths, named pipes without ACLs)?
- Data loss: what happens on crash mid-write, disk full, two instances running, a corrupted store, an upgrade that changes the schema and then a downgrade?
- Responsiveness: which operation will someone eventually run on a 10× larger input, and does it block the UI or exhaust memory?
- Supply chain: dependency count, maintenance status, pinned versions and lockfiles, build reproducibility, how the update channel could be hijacked.
- Operability: can a user's bug report be diagnosed from the log alone? Can you roll back a bad release?

Present findings to the operator, revise decisions with them, then write.

## Step 3 — Write `docs/FOUNDATION.md`

Write in the language the operator is using in the conversation. Use this structure; every section holds decisions, not intentions. For a subsystem, append a `## Subsystem: <name>` section with the same subsections in miniature.

```markdown
# Foundation — <project>
Last updated: <date> · Scope: kickoff | subsystem

## Purpose & success metric
## Non-goals (v1)
## Users, privileges & trust boundaries
## Architecture decisions
| Decision | Choice | Why | Alternatives rejected | Revisit when |
Include: layering/dependency direction, concurrency model, persistence & migrations, config vs secrets, extension/trust model.
## Security model
| Asset | Threat | Mitigation | Status |
Plus fixed controls: input validation at boundaries, path handling, process/IPC rules, secret storage, signing, update verification.
## Performance budgets
Numbers + how each is measured (benchmark harness, profiler, CI check).
## Quality gates
Enforced automatically vs reviewed by a human.
## Lifecycle & operations
Build, packaging, signing, distribution, updates, logging, crash reporting, rollback.
## Open risks
```

Then add to `CLAUDE.md` (create if missing):

```
## Foundation
Read docs/FOUNDATION.md before architectural, security, persistence, concurrency or performance work. Its decisions are binding; propose changes there rather than diverging in code.
```

## Step 4 — Day-one enforcement

Set up what is checkable now, adapted to the stack:

- Compiler strictness: warnings as errors, nullable reference types on (.NET), `-Wall -Wextra -Werror` (C/C++), `mypy --strict`/`pyright` (Python), clippy deny warnings (Rust). Analyzer packages enabled (e.g. Microsoft.CodeAnalysis.NetAnalyzers with security rules).
- Format + lint in a pre-commit hook; `.editorconfig` committed.
- Secrets: `.gitignore` covers local config with secrets; secret scanning (gitleaks or equivalent) in pre-commit and CI.
- Dependencies: pinned versions, lockfile committed, vulnerability audit in CI (`dotnet list package --vulnerable`, `pip-audit`, `cargo audit`, `npm audit`), Renovate/Dependabot enabled.
- Tests: runner wired with one real domain test and one persistence round-trip test (write → read → migrate); in CI.
- Build: CI builds on every PR for every target OS; release builds signed; SBOM generated if distributing to others.
- Crash safety: atomic write helper in place for the persistence layer; a test that kills the process mid-write and verifies recovery, if persistence is file-based.
- Responsiveness guard: a debug-mode check that flags UI-thread stalls (e.g. a watchdog logging any dispatcher gap > 100ms).

Anything that can't be set up now goes under Open risks with an owner.

## Step 5 — Handoff

The foundation is done when: FOUNDATION.md has no empty sections, CLAUDE.md points to it, enforcement is committed or its absence is a listed risk, and the operator has confirmed the decisions. Do not start feature code inside this skill. End by proposing the first implementation plan (plan mode), starting with the riskiest decision — usually persistence or the concurrency model — so it gets validated first.