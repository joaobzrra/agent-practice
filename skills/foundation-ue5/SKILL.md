---
name: foundation-ue5
description: "Kickoff/major-system foundation protocol for Unreal Engine 5 games: pillars, budgets on reference hardware, C++/BP boundary, authority model, docs/FOUNDATION.md, day-one enforcement."
---

# Foundation — UE5

## Why this exists

Games die at the foundation more than any other software the operator builds: a Blueprint-only prototype that can't be optimized, a save system that isn't versioned, networking bolted onto single-player code, no performance budget until the frame rate collapses on the target machine, a repo that can't handle binary assets. Every one of those is a decision that was never made. This skill forces them early, writes them into the repo so every later session inherits them, and sets up enforcement on day one. Target: AAA discipline, whatever the team size.

Operating rules while this skill is active:

- Do not shrink the job to save tokens or time. Correctness, performance and security beat brevity. Use plan mode for anything non-trivial and spawn a reviewer subagent for the adversarial pass if available.
- Ask only what is undecided. Read first, then interview; 3 rounds of 3–4 sharp questions, not a form.
- Push back on weak answers ("we'll optimize later", "multiplayer maybe someday"). the operator prefers stress-tested arguments over validation. "Maybe multiplayer" means design for authority now or commit to single-player in writing.
- Every decision must be decidable and written. "Keep it performant" is not a decision. "16.6ms frame budget at 1080p on a GTX 1660: 7ms game thread, 9ms render, 2ms GPU headroom; measured weekly with Unreal Insights on the reference machine" is.

## Step 0 — Read before asking

Gather what exists: the repo (including uncommitted working tree), `CLAUDE.md`, `docs/FOUNDATION.md`, `.uproject` (engine version, plugins), `Config/*.ini`, `Source/` module structure, `Content/` layout, `.gitattributes`/`.gitignore`, any existing design doc, and the `ue5` skill's notes. Decide scope:

- **Kickoff**: no `docs/FOUNDATION.md` (or fresh project). Full protocol, create the document.
- **Subsystem**: `docs/FOUNDATION.md` exists. Read it, honor its decisions, run the protocol only for the new system, append a `## Subsystem: <name>` section.

Summarize in 5–10 lines what is known and what is undecided.

If the project spans domains (a game with a companion website or app), run the matching foundation skill for each part but keep a single `docs/FOUNDATION.md` with one section per part.

## Step 1 — Interview (AskUserQuestion)

Use AskUserQuestion, 2–4 questions per round, recommended option first, one line on why it matters. Skip what Step 0 answered. Order matters.

**Pillars and scope**
- The game in one sentence, and 2–3 design pillars every system must serve. Anything that serves no pillar is a non-goal.
- Explicit non-goals for the first playable / vertical slice.
- Scope reality check: team size, hours per week, target date. Ask what gets cut if the date slips — decide the cut order now.

**Platform and budgets**
- Target platforms and the minimum-spec reference machine (exact GPU/CPU/RAM). Budgets are meaningless without it.
- Frame-time budget split (game thread / render thread / GPU) at target resolution and framerate; memory ceiling; load-time and streaming budgets; package size ceiling.
- Rendering path: Nanite + Lumen + VSM (raises min spec, simplifies content) vs baked lighting/LODs (more content work, lower floor). Decide from the min spec, not from what looks nice in the editor. Mobile targets change everything — see the `ue5` skill.

**Engine and code structure**
- Engine version pinned; launcher vs source build (source needed for engine patches, console SDKs, deep profiling). Plugins allowed in the base project.
- C++ / Blueprint boundary. Recommended default: systems, data structures, anything per-frame or performance-critical in C++; content, tuning and level scripting in Blueprint; all tunables in Data Assets/Data Tables, never hardcoded. Write the rule so it's checkable.
- Module layout (`Source/<Game>` split into modules by domain once it grows: Core, Gameplay, UI, Editor-only tooling).
- Gameplay framework: Gameplay Ability System vs custom. GAS for anything with abilities/attributes/effects and any multiplayer; custom only for small single-player scopes with a stated reason.

**Networking and trust**
- Single-player only (in writing), co-op, or competitive multiplayer. If any multiplayer: server-authoritative from day one, client predicts only what is designed to be predicted, every RPC validated on the server (`_Validate`), no gameplay-affecting state trusted from clients.
- Hosting model (listen server / dedicated / service), session/matchmaking, anti-cheat expectations.
- Save data: versioned format, validated on load, treated as untrusted input; what is saved, where, cloud sync or not; migration path between versions.

**Content and pipeline**
- World structure: World Partition + streaming vs sublevels; level size and streaming distance derived from budgets.
- Asset naming convention and folder structure (adopt a published UE style guide and reference it), texture/mesh budgets per asset class, import settings standardized.
- Source control: Perforce (best for binaries and locking) vs Git + LFS with file locking; `.gitattributes` for `.uasset/.umap`; who can edit which content folders.
- Input via Enhanced Input; UI via UMG/CommonUI; audio middleware (MetaSounds vs Wwise/FMOD); localization from day one or not.
- Build pipeline: automated cook/package for every target (use a dedicated build skill if the project has one), nightly build, automation tests (Functional Tests, Gauntlet), Data Validation plugin rules.

## Step 2 — Adversarial pass

Attack the plan before writing it down. Produce 5–10 findings covering:

- Performance: which system will scale with entity count (AI perception, physics, tick-heavy actors, Niagara)? What ticks every frame that shouldn't? What is the worst-case scene for draw calls, overdraw, shadow-casting lights, streaming?
- Memory: texture budget at min spec, streaming pool size, audio memory, what leaks across level transitions.
- Trust: if multiplayer, which client message could be forged to gain an advantage? If single-player, which save-file edit crashes the game or corrupts progress?
- Content risk: which asset class or workflow will the team produce fastest and least consistently? What's the validation rule?
- Engine risk: which engine feature is experimental/beta in the pinned version? What is the fallback if it breaks on the target platform?
- Pipeline: how long is a full cook? Can a clean checkout build without manual steps? What happens when two people edit the same map?
- Scope: which pillar is most expensive, and what is the smallest version of it that still proves the game?

Present findings to the operator, revise decisions with them, then write.

## Step 3 — Write `docs/FOUNDATION.md`

Write in the language the operator is using in the conversation. Use this structure; decisions, not intentions. For a subsystem, append a `## Subsystem: <name>` section with the same subsections in miniature.

```markdown
# Foundation — <game>
Last updated: <date> · Scope: kickoff | subsystem

## Pillars & success criteria
## Non-goals (first playable)
## Targets & reference hardware
## Performance budgets
Frame-time split, memory, streaming, load, package size — numbers + how measured (Unreal Insights, stat commands, reference machine, cadence).
## Architecture decisions
| Decision | Choice | Why | Alternatives rejected | Revisit when |
Include: engine version/build, C++/BP boundary, modules, gameplay framework, world structure, rendering path, save system, input/UI/audio.
## Networking & trust model
Authority, prediction, RPC validation, save-data trust, anti-cheat stance.
## Content pipeline
Naming/folder conventions (link to style guide), asset budgets, import standards, source control rules.
## Quality gates
Automated (build, tests, data validation, perf capture) vs reviewed.
## Build & release
Cook/package automation, nightly, platforms, versioning.
## Open risks
```

Then add to `CLAUDE.md` (create if missing):

```
## Foundation
Read docs/FOUNDATION.md before architectural, performance, networking, save-system or content-pipeline work. Its decisions are binding; propose changes there rather than diverging in code or content.
```

## Step 4 — Day-one enforcement

Set up what is checkable now:

- Source control: `.gitignore` for UE (Binaries, Intermediate, DerivedDataCache, Saved), `.gitattributes` routing `.uasset/.umap` and large binaries through LFS with locking; or Perforce typemap. Verify a clean clone opens.
- Code: `.clang-format` and `.editorconfig` committed; UE coding standard enforced; C++ warnings as errors for the game module where practical.
- Automated build: a script/CI job that builds Editor + packages one target from a clean checkout; fails on cook errors and warnings you decide to treat as errors.
- Tests: Automation framework enabled with one Functional Test for the core loop and one unit test for a pure C++ system; run in CI.
- Data Validation plugin with rules for naming convention, missing references, texture size caps, and asset budgets; run on save and in CI.
- Performance capture: a `stat`/Insights capture script on a reference map, recorded per build so regressions are visible; a debug HUD or CSV profiler bookmark for the frame-time split.
- Save system: versioned header and a load-time validator with a test that feeds corrupt/old saves.
- Networking (if any): server-side validation stubs on every RPC from the first commit; `net.PktLag`/`PktLoss` test config committed.

Anything that can't be set up now goes under Open risks with an owner.

## Step 5 — Handoff

The foundation is done when: FOUNDATION.md has no empty sections, CLAUDE.md points to it, enforcement is committed or listed as a risk, and the operator has confirmed the decisions. Do not start gameplay code inside this skill. End by proposing the first implementation plan (plan mode), starting with the riskiest decision — usually the performance budget on the reference machine or the authority model — so it gets validated before content is built on top of it.