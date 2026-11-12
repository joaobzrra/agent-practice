import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  applyReview, contentHash, currentClaims, dashboardSnapshot, formatPack, loadLedger, normalizePath,
  resolveAnchor, routeContext, semanticIssues, stableJson
} from "../src/ledger.mjs";
import { buildHookOutput } from "../src/hook.mjs";
import { fixtureConfig, makeProject, tempDir } from "../fixtures/project.mjs";

// Every test here reads the fixture project, never the project this package is
// copied into. See fixtures/project.mjs for why.
const project = makeProject();
const ledger = loadLedger(project.root);

test("fixture ledger has valid lifecycle chains and references", () => {
  assert.deepEqual(semanticIssues(ledger).filter(issue => issue.level === "error"), []);
});

test("invalid lifecycle transition is rejected semantically", () => {
  const copy = structuredClone(ledger);
  const claim = copy.claims.find(item => item.id === "CLM-reminders-sent-once");
  claim.history.push({ from: "enforced", to: "accepted", at: "2026-01-16T00:00:00Z", actor: "test", source: "test" });
  claim.state = "accepted";
  assert(semanticIssues(copy).some(issue => issue.code === "lifecycle"));
});

test("a superseded claim is excluded and its replacement remains", () => {
  const ids = currentClaims(ledger).map(claim => claim.id);
  assert(!ids.includes("CLM-nightly-report-untested"));
  assert(ids.includes("CLM-nightly-report-tested"));
});

test("a resolved conflict routes as accepted intent, not as an open conflict", () => {
  const pack = routeContext(ledger, {
    prompt: "build the waitlist page",
    paths: ["src/waitlist/page.js"]
  });
  assert(pack.acceptedIntent.some(claim => claim.id === "CLM-waitlist-notify-only"));
  assert(!pack.openConflicts.some(claim => claim.id === "CLM-waitlist-undecided"));
});

test("symbol, heading, YAML path, file, and excerpt anchors detect content drift", () => {
  const root = tempDir("ledger-anchor-");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "Thing.cs"), "public class Thing\n{\n    public void Run() { }\n}\n", "utf8");
  writeFileSync(join(root, "guide.md"), "# Guide\n\n## Rule\nKeep it safe.\n\n## Next\nDone.\n", "utf8");
  writeFileSync(join(root, "ci.yml"), "jobs:\n  backend:\n    runs-on: ubuntu-latest\n  frontend:\n    runs-on: ubuntu-latest\n", "utf8");
  // The expected hashes are written out from the text each locator should
  // select. Taking them from the resolver's own first answer would pass
  // whatever the resolver selected.
  const symbol = { path: "src/Thing.cs", locator: { kind: "symbol", value: "Thing.Run" }, normalizedContentHash: contentHash("    public void Run() { }") };
  assert.equal(resolveAnchor(symbol, root).ok, true, "the symbol locator selects the method, not the file");
  const file = { path: "ci.yml", locator: { kind: "file", value: "" }, normalizedContentHash: contentHash("jobs:\n  backend:\n    runs-on: ubuntu-latest\n  frontend:\n    runs-on: ubuntu-latest\n") };
  assert.equal(resolveAnchor(file, root).ok, true);
  const heading = { path: "guide.md", locator: { kind: "heading", value: "Rule" }, normalizedContentHash: contentHash("## Rule\nKeep it safe.") };
  assert.equal(resolveAnchor(heading, root).ok, true);
  const excerpt = { path: "guide.md", locator: { kind: "excerpt", value: "Keep it safe." }, normalizedContentHash: contentHash("Keep it safe.") };
  assert.equal(resolveAnchor(excerpt, root).ok, true);
  const yaml = { path: "ci.yml", locator: { kind: "yamlPath", value: "$.jobs.backend" }, normalizedContentHash: contentHash("  backend:\n    runs-on: ubuntu-latest") };
  assert.equal(resolveAnchor(yaml, root).ok, true);
  writeFileSync(join(root, "guide.md"), "# Guide\n\n## Rule\nChanged.\n", "utf8");
  assert.equal(resolveAnchor(heading, root).stale, true);
  assert.equal(resolveAnchor(excerpt, root).ok, false);
  // Drift inside the selected part is seen; drift outside it is not.
  writeFileSync(join(root, "src", "Thing.cs"), "// edited\npublic class Thing\n{\n    public void Run() { }\n}\n", "utf8");
  assert.equal(resolveAnchor(symbol, root).ok, true, "a change outside the method leaves the symbol anchor current");
  writeFileSync(join(root, "src", "Thing.cs"), "public class Thing\n{\n    public void Run() { Stop(); }\n}\n", "utf8");
  assert.equal(resolveAnchor(symbol, root).stale, true);
  writeFileSync(join(root, "ci.yml"), "jobs:\n  backend:\n    runs-on: ubuntu-latest\n  frontend:\n    runs-on: windows-latest\n", "utf8");
  assert.equal(resolveAnchor(yaml, root).ok, true, "a change to another job leaves the YAML anchor current");
  assert.equal(resolveAnchor(file, root).stale, true, "the same change is drift for a whole-file anchor");
  writeFileSync(join(root, "ci.yml"), "jobs:\n  backend:\n    runs-on: windows-latest\n", "utf8");
  assert.equal(resolveAnchor(yaml, root).stale, true);
});

test("Windows and Linux path separators route identically", () => {
  // The prompt shares no word with any claim, so only the path can retrieve
  // the reminder rule. The check without a path proves that.
  const prompt = "qqq zzz";
  assert(!routeContext(ledger, { prompt }).expansionHandles.includes("CLM-reminders-sent-once"));
  const linux = routeContext(ledger, { prompt, paths: ["src/jobs/reminders.js"] });
  const windows = routeContext(ledger, { prompt, paths: ["src\\jobs\\reminders.js"] });
  assert(linux.expansionHandles.includes("CLM-reminders-sent-once"));
  assert(windows.expansionHandles.includes("CLM-reminders-sent-once"), "a backslash path must match a claim scoped with forward slashes");
  assert.equal(stableJson(windows), stableJson(linux));
  assert.equal(normalizePath("src\\modules\\Thing.cs"), "src/modules/Thing.cs");
});

test("every scenario returns every declared active claim", () => {
  const critical = ledger.claims.filter(claim => claim.universal && claim.severity === "critical" && ["accepted", "verified", "enforced", "contested"].includes(claim.state)).map(claim => claim.id);
  assert(critical.length > 0, "the fixture must hold a critical universal claim, or the loop below proves less than it says");
  for (const scenario of ledger.scenarios) {
    const pack = routeContext(ledger, { prompt: scenario.prompt, paths: scenario.paths });
    const returned = new Set(pack.expansionHandles);
    for (const expected of [...scenario.expectedClaims, ...critical]) assert(returned.has(expected), `${scenario.id} missed ${expected}`);
    const claims = [...pack.bindingInvariants, ...pack.currentVerifiedFacts, ...pack.acceptedIntent, ...pack.openConflicts];
    assert(claims.every(claim => claim.state !== "superseded"));
    assert(claims.every(claim => claim.state && claim.authority && Array.isArray(claim.provenance)));
  }
});

// Builds its own proposed claim instead of naming one in a ledger. Pointing this at a
// stored claim makes the test depend on that claim staying un-accepted forever: the day
// someone accepts it, applyReview refuses the transition accepted -> accepted and this
// fails.
test("product and architecture acceptance is user-gated and audited", () => {
  const root = tempDir("ledger-review-");
  mkdirSync(join(root, "context"));
  const proposal = {
    id: "CLM-test-proposal", title: "Test proposal", statement: "An invariant awaiting user acceptance.",
    kind: "invariant", state: "proposed", authority: { kind: "session", source: "test" },
    scope: { topics: [], paths: [], entities: [] }, universal: false, severity: "low",
    relationships: [], evidence: [],
    history: [{ from: null, to: "proposed", at: "2026-01-15T00:00:00Z", actor: "test", source: "test" }]
  };
  const copy = { claims: [proposal], documents: [], scenarios: [] };
  assert.throws(() => applyReview(copy, [{ claimId: proposal.id, decision: "accept", approver: { kind: "agent", name: "Claude" }, sourceSession: "s1" }], { root }), /explicit user authority/);
  applyReview(copy, [{ claimId: proposal.id, decision: "accept", approver: { kind: "user", name: "user" }, sourceSession: "s2", timestamp: "2026-01-15T00:30:00Z", evidence: [`user message: accept ${proposal.id}`], note: "yes" }], { root });
  const written = JSON.parse(readFileSync(join(root, "context", "claims.json"), "utf8"));
  const claim = written.find(item => item.id === proposal.id);
  assert.equal(claim.state, "accepted");
  assert.equal(claim.history.at(-1).source, "s2");
  assert.equal(claim.history.at(-1).actor, "user");
  assert(claim.history.at(-1).evidence.length > 0);
});

test("mechanical verification requires a fact, a current anchor, and a passing command", () => {
  const root = tempDir("ledger-verify-");
  mkdirSync(join(root, "context"));
  writeFileSync(join(root, "fact.txt"), "stable fact\n", "utf8");
  const fact = {
    id: "CLM-test-fact", title: "Test fact", statement: "This fact is mechanically checked.", kind: "fact", state: "proposed",
    authority: { kind: "implementation", source: "test" }, scope: { topics: [], paths: ["fact.txt"], entities: [] }, universal: false, severity: "low", relationships: [],
    evidence: [{ path: "fact.txt", locator: { kind: "file", value: "" }, normalizedContentHash: contentHash("stable fact\n"), displayLine: 1, verifiedAtCommit: "abc1234", verification: { kind: "test", command: `"${process.execPath}" -e "process.exit(0)"`, test: "exit zero" } }],
    history: [{ from: null, to: "proposed", at: "2026-01-15T00:00:00Z", actor: "test", source: "test" }]
  };
  const mini = { claims: [fact], documents: [], scenarios: [] };
  applyReview(mini, [{ claimId: fact.id, decision: "verify", approver: { kind: "agent", name: "Claude" }, sourceSession: "s3" }], { root });
  assert.equal(fact.state, "verified");
  const notFact = structuredClone(fact);
  notFact.id = "CLM-test-intent";
  notFact.kind = "intent";
  notFact.state = "proposed";
  notFact.history = [{ from: null, to: "proposed", at: "2026-01-15T00:00:00Z", actor: "test", source: "test" }];
  assert.throws(() => applyReview({ claims: [notFact] }, [{ claimId: notFact.id, decision: "verify", approver: { kind: "agent", name: "Claude" }, sourceSession: "s4" }], { root }), /not a mechanically verifiable fact/);
});

test("hooks fail open, deduplicate resume/prompt injection, and propagate active packs", () => {
  const stateRoot = tempDir("ledger-hook-");
  const root = project.root;
  assert.equal(buildHookOutput("SessionStart", { session_id: "missing" }, { root: join(stateRoot, "missing"), stateRoot }), null);
  const start = buildHookOutput("SessionStart", { session_id: "session-1", source: "startup" }, { root, stateRoot });
  // Assert the MECHANISM (startup injects a routed pack), never a specific claim id: which
  // claims are universal is ledger content and changes.
  const startContext = start?.hookSpecificOutput.additionalContext ?? "";
  assert.match(startContext, /CLM-[a-z0-9-]+/);
  assert.match(startContext, new RegExp(`^# ${fixtureConfig.displayName} routed context`));
  assert.equal(buildHookOutput("SessionStart", { session_id: "session-1", source: "resume" }, { root, stateRoot }), null);
  const prompt = { session_id: "session-1", prompt: "change the wording of the reminder email" };
  const routed = buildHookOutput("UserPromptSubmit", prompt, { root, stateRoot });
  assert(routed?.hookSpecificOutput.additionalContext.includes("CLM-reminders-sent-once"));
  assert.equal(buildHookOutput("UserPromptSubmit", prompt, { root, stateRoot }), null);
  const subagent = buildHookOutput("SubagentStart", { session_id: "session-1", agent_id: "agent-a", agent_type: "Explore" }, { root, stateRoot });
  assert(subagent?.hookSpecificOutput.additionalContext.includes("CLM-reminders-sent-once"));
  // Propagation of the session-start pack, asserted via whichever claim it actually injected.
  const startClaim = startContext.match(/CLM-[a-z0-9-]+/)[0];
  assert(subagent?.hookSpecificOutput.additionalContext.includes(startClaim));
  assert.equal(buildHookOutput("SubagentStart", { session_id: "session-1", agent_id: "agent-a" }, { root, stateRoot }), null);
});

test("dashboard snapshot exposes authority, attention, and resolved evidence health", () => {
  const snapshot = dashboardSnapshot(ledger, {
    root: project.root,
    observedAt: "2026-01-20T12:00:00.000Z",
    commit: "test-commit"
  });
  assert.equal(snapshot.source.commit, "test-commit");
  assert.equal(snapshot.claims.length, ledger.claims.length);
  assert.equal(snapshot.documents.length, ledger.documents.length);
  assert.equal(snapshot.health.needsJudgment, ledger.claims.filter(claim => claim.state === "contested" || (claim.state === "proposed" && claim.authority.kind === "session")).length);
  assert.equal(snapshot.health.needsJudgment, 2, "the fixture holds one contested claim and one session proposal");
  // The superseded claim's anchor really is stale, and that drift is not
  // counted against the ledger.
  const superseded = snapshot.claims.find(claim => claim.id === "CLM-nightly-report-untested");
  assert.equal(superseded.evidence[0].health, "stale");
  assert.equal(snapshot.health.staleAnchors, 0);
  assert.equal(superseded.attention.needsJudgment, false);
  assert.equal(superseded.attention.staleEvidence, false);
  const enforced = snapshot.claims.find(claim => claim.id === "CLM-reminders-sent-once");
  assert(enforced.evidence.length > 0);
  assert(enforced.evidence.every(anchor => anchor.health === "current"));
});

test("routed context heading uses the configured display name", () => {
  const pack = routeContext(ledger, { prompt: "session start universal invariants", limit: 5 });
  assert.match(formatPack(pack, { displayName: "Tablebook" }), /^# Tablebook routed context/);
});

test("snapshot repository comes from config, not a literal", () => {
  const snapshot = dashboardSnapshot(ledger, { root: project.root, observedAt: "2026-01-20T00:00:00.000Z", commit: "abc1234" });
  assert.equal(snapshot.source.repository, fixtureConfig.repository);
});
