import assert from "node:assert/strict";
import test from "node:test";
import { activeStates, formatPack, loadLedger, routeContext, routingBudget, semanticIssues } from "../src/ledger.mjs";
import { makeProject } from "../fixtures/project.mjs";

// A stored ledger read from disk, as opposed to the inline fixtures below.
// It is the fixture project, never the project this package is copied into.
const ledger = loadLedger(makeProject().root);

function claim(overrides) {
  return {
    id: "CLM-fixture",
    title: "Fixture",
    statement: "Fixture statement.",
    kind: "fact",
    state: "accepted",
    authority: { kind: "instruction", source: "test" },
    scope: { topics: [], paths: [], entities: [] },
    universal: false,
    severity: "low",
    relationships: [],
    evidence: [],
    history: [],
    ...overrides
  };
}

function idsFrom(pack) {
  return new Set(pack.expansionHandles);
}

test("proposed claims are excluded before scoring, however well scoped", () => {
  assert.equal(activeStates.has("proposed"), false);
  const fixture = {
    claims: [claim({ id: "CLM-proposed-scoped", state: "proposed", scope: { topics: ["deployment"], paths: ["src"], entities: [] } })],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "deployment", paths: ["src"] });
  assert.equal(idsFrom(pack).has("CLM-proposed-scoped"), false);
});

test("a universal claim is returned regardless of the prompt", () => {
  const fixture = {
    claims: [claim({ id: "CLM-universal", universal: true })],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "something entirely unrelated" });
  assert.ok(idsFrom(pack).has("CLM-universal"));
});

test("a path match retrieves a claim whose words do not match at all", () => {
  const fixture = {
    claims: [claim({ id: "CLM-by-path", scope: { topics: ["zzzz"], paths: ["src/modules"], entities: [] } })],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "no overlapping vocabulary here", paths: ["src/modules/orders"] });
  assert.ok(idsFrom(pack).has("CLM-by-path"), "path prefix match should retrieve it");
});

test("a claim with neither paths nor matching words is never returned", () => {
  const fixture = {
    claims: [claim({ id: "CLM-unreachable", scope: { topics: ["quixotic"], paths: [], entities: [] } })],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "deployment hosting identity" });
  assert.equal(idsFrom(pack).has("CLM-unreachable"), false);
});

test("tokens shorter than three characters do not drive retrieval", () => {
  const fixture = {
    claims: [claim({ id: "CLM-short", scope: { topics: ["db"], paths: [], entities: [] } })],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "db" });
  assert.equal(idsFrom(pack).has("CLM-short"), false);
});

test("a conflicting claim is pulled in even when it scores zero", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-anchor", scope: { topics: ["deployment"], paths: [], entities: [] }, relationships: [{ target: "CLM-other-side", type: "conflictsWith" }] }),
      claim({ id: "CLM-other-side", scope: { topics: ["nothingalike"], paths: [], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "deployment" });
  const ids = idsFrom(pack);
  assert.ok(ids.has("CLM-anchor"));
  assert.ok(ids.has("CLM-other-side"), "a conflict must never load only one side");
});

test("limit truncates the routed set", () => {
  const prompt = "reminder report waitlist migration refund";
  const unlimited = routeContext(ledger, { prompt });
  assert.ok(unlimited.expansionHandles.length > 3, "the prompt must match more than the limit, or nothing is truncated");
  const pack = routeContext(ledger, { prompt, limit: 3 });
  assert.equal(pack.expansionHandles.length, 3);
});

test("a contested claim routes for a prompt it shares no word with", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-disputed", state: "contested", scope: { topics: ["quixotic"], paths: [], entities: [] } }),
      claim({ id: "CLM-settled", state: "accepted", scope: { topics: ["quixotic"], paths: [], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const ids = idsFrom(routeContext(fixture, { prompt: "zzz qqq" }));
  assert.ok(ids.has("CLM-disputed"), "being contested is enough to route");
  assert.equal(ids.has("CLM-settled"), false, "the same claim, settled, needs a match");
});

test("a stored ledger routes something for a realistic prompt", () => {
  const pack = routeContext(ledger, { prompt: "reword reminder email" });
  assert.ok(idsFrom(pack).has("CLM-reminders-sent-once"), "the claim the prompt is about must come back, not only the universal one");
});

test("a conflict pair at the exact cap is skipped whole, never split", () => {
  // A fills one of two slots; the pair {B, C} no longer fits and must be
  // rejected atomically; the smaller D takes the remaining slot instead.
  const fixture = {
    claims: [
      claim({ id: "CLM-alone", scope: { topics: ["deployment", "hosting"], paths: [], entities: [] } }),
      claim({ id: "CLM-pair-anchor", scope: { topics: ["deployment"], paths: [], entities: [] }, relationships: [{ target: "CLM-pair-other", type: "conflictsWith" }] }),
      claim({ id: "CLM-pair-other", scope: { topics: ["nothingalike"], paths: [], entities: [] } }),
      claim({ id: "CLM-small-filler", scope: { topics: ["hosting"], paths: [], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "deployment deployment hosting", limit: 2 });
  const ids = idsFrom(pack);
  assert.ok(pack.expansionHandles.length <= 2, "the limit stays a hard cap");
  assert.equal(ids.has("CLM-pair-anchor"), ids.has("CLM-pair-other"), "a conflict pair must route whole or not at all");
  assert.ok(ids.has("CLM-alone"));
  assert.ok(ids.has("CLM-small-filler"), "a smaller component may use the room the pair could not");
});

test("an inbound-only conflict edge still pulls the declaring side in", () => {
  // Only CLM-declarer states the conflict; CLM-target is what the prompt
  // retrieves. The edge is undirected, so both must appear.
  const fixture = {
    claims: [
      claim({ id: "CLM-target", scope: { topics: ["deployment"], paths: [], entities: [] } }),
      claim({ id: "CLM-declarer", scope: { topics: ["nothingalike"], paths: [], entities: [] }, relationships: [{ target: "CLM-target", type: "conflictsWith" }] })
    ],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "deployment" });
  const ids = idsFrom(pack);
  assert.ok(ids.has("CLM-target"));
  assert.ok(ids.has("CLM-declarer"), "the side that declared the conflict must ride along");
});

test("a transitive conflict chain routes as one component", () => {
  const chain = [
    claim({ id: "CLM-chain-a", scope: { topics: ["deployment"], paths: [], entities: [] }, relationships: [{ target: "CLM-chain-b", type: "conflictsWith" }] }),
    claim({ id: "CLM-chain-b", scope: { topics: ["nothingalike"], paths: [], entities: [] }, relationships: [{ target: "CLM-chain-c", type: "conflictsWith" }] }),
    claim({ id: "CLM-chain-c", scope: { topics: ["unrelatedtoo"], paths: [], entities: [] } })
  ];
  const fixture = { claims: chain, documents: [], scenarios: [] };
  const full = idsFrom(routeContext(fixture, { prompt: "deployment" }));
  assert.ok(full.has("CLM-chain-a") && full.has("CLM-chain-b") && full.has("CLM-chain-c"), "the whole chain rides in when it fits");
  const capped = idsFrom(routeContext(fixture, { prompt: "deployment", limit: 2 }));
  assert.equal(capped.size, 0, "a chain that cannot fit whole must not route partially");
});

test("superseded conflict counterparts are not resurrected by the component", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-live", scope: { topics: ["deployment"], paths: [], entities: [] } }),
      claim({ id: "CLM-dead", state: "superseded", scope: { topics: [], paths: [], entities: [] }, relationships: [{ target: "CLM-live", type: "conflictsWith" }], history: [] })
    ],
    documents: [],
    scenarios: []
  };
  const ids = idsFrom(routeContext(fixture, { prompt: "deployment" }));
  assert.ok(ids.has("CLM-live"));
  assert.equal(ids.has("CLM-dead"), false, "superseded claims stay out of routing");
});

test("a critical universal claim cannot be dropped by alphabetical tiebreak", () => {
  // Sixteen medium universals alphabetically ahead of one critical universal,
  // routed at a limit of sixteen: the critical claim must survive and a
  // medium one must be the deterministic casualty.
  const mediums = Array.from({ length: 16 }, (_, index) => claim({
    id: `CLM-a${String(index + 1).padStart(2, "0")}`,
    universal: true,
    severity: "medium"
  }));
  const fixture = {
    claims: [...mediums, claim({ id: "CLM-zz-critical", universal: true, severity: "critical" })],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "anything at all", limit: 16 });
  const ids = idsFrom(pack);
  assert.ok(ids.has("CLM-zz-critical"), "severity, not id order, decides which universal survives an overflow");
  assert.equal(pack.expansionHandles.length, 16);
  assert.equal(ids.has("CLM-a16"), false, "the drop is deterministic: the last of the least severe");
});

test("a universal claim drags its non-universal conflict counterpart into the mandatory tier", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-universal-side", universal: true, severity: "critical", relationships: [{ target: "CLM-scoped-side", type: "conflictsWith" }] }),
      claim({ id: "CLM-scoped-side", scope: { topics: ["nothingalike"], paths: [], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const ids = idsFrom(routeContext(fixture, { prompt: "unrelated prompt" }));
  assert.ok(ids.has("CLM-universal-side"));
  assert.ok(ids.has("CLM-scoped-side"), "the counterpart must ride along even with zero relevance");
});

test("validation fails when the always-inject closure exceeds the routing budget", () => {
  const overflow = Array.from({ length: routingBudget + 1 }, (_, index) => claim({
    id: `CLM-u${String(index + 1).padStart(2, "0")}`,
    universal: true,
    history: [{ from: null, to: "accepted" }]
  }));
  const fixture = { claims: overflow, documents: [], scenarios: [] };
  const issues = semanticIssues(fixture);
  assert.ok(issues.some(issue => issue.level === "error" && issue.code === "universal-overflow"), "an unroutable mandatory set must fail validation, not fail silently at runtime");
});

test("a stored ledger injects every universal claim at the hook budget", () => {
  const universalIds = ledger.claims.filter(item => item.universal && activeStates.has(item.state)).map(item => item.id);
  assert.ok(universalIds.length > 0, "the fixture must hold a universal claim");
  const pack = routeContext(ledger, { prompt: "nightly report tests", paths: [], limit: routingBudget });
  const ids = idsFrom(pack);
  for (const id of universalIds) assert.ok(ids.has(id), `${id} is universal and must be injected`);
  assert.ok(ids.has("CLM-nightly-report-tested"), "the scoped claim the prompt names rides in beside the universal one");
  assert.deepEqual(pack.droppedMandatory, [], "at the hook budget nothing mandatory is dropped");
});

test("a limit below the mandatory closure names what it dropped", () => {
  // Three universals at limit 2: the least-severe one is skipped — and the pack
  // must say so, structured for JSON consumers and rendered for the prompt.
  // The fixture is synthetic on purpose. An earlier version asserted against
  // the real ledger, which made an unrelated session's new claims fail this
  // test; the behaviour under scrutiny belongs to routing, not to content.
  const fixture = {
    claims: [
      claim({ id: "CLM-keep-critical", universal: true, severity: "critical", scope: { topics: ["alpha"], paths: [], entities: [] } }),
      claim({ id: "CLM-keep-high", universal: true, severity: "high", scope: { topics: ["alpha"], paths: [], entities: [] } }),
      claim({ id: "CLM-drop-low", universal: true, severity: "low", scope: { topics: ["alpha"], paths: [], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "alpha", paths: [], limit: 2 });
  assert.deepEqual(pack.droppedMandatory, ["CLM-drop-low"], "the drop is deterministic, least-severe first, and named rather than counted");
  assert.equal(idsFrom(pack).size, 2, "the cap still holds");
  const rendered = formatPack(pack, { displayName: "Test" });
  assert.match(rendered, /Budget overflow: 1 always-inject rule/);
  assert.match(rendered, /`CLM-drop-low`/);
});

test("dropping a non-mandatory component reports nothing", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-first", scope: { topics: ["deployment"], paths: [], entities: [] } }),
      claim({ id: "CLM-pair-a", scope: { topics: ["deployment"], paths: [], entities: [] }, relationships: [{ target: "CLM-pair-b", type: "conflictsWith" }] }),
      claim({ id: "CLM-pair-b", scope: { topics: [], paths: [], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "deployment", limit: 1 });
  assert.deepEqual(pack.droppedMandatory, [], "only mandatory drops are a broken promise worth flagging");
  const rendered = formatPack(pack, { displayName: "Test" });
  assert.doesNotMatch(rendered, /Budget overflow/);
});
