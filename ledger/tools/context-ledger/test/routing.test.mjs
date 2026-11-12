import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { activeStates, formatPack, loadLedger, mentionedPaths, routeContext, routingBudget, semanticIssues } from "../src/ledger.mjs";
import { makeProject, tempDir } from "../fixtures/project.mjs";

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

test("a word still matches when punctuation follows it", () => {
  const fixture = {
    claims: [claim({ id: "CLM-email", scope: { topics: ["reminder"], paths: [], entities: [] } })],
    documents: [],
    scenarios: []
  };
  for (const prompt of ["fix reminder.", "reminder, please", "(reminder)", "what about reminder?"]) {
    assert.ok(idsFrom(routeContext(fixture, { prompt })).has("CLM-email"), `"${prompt}" names the topic`);
  }
});

test("filler words alone retrieve nothing", () => {
  // Every claim statement contains words like these. While they scored, any
  // prompt at all matched most of a ledger and the pack was always full.
  const fixture = {
    claims: [claim({ id: "CLM-wordy", title: "The job and the queue", statement: "The job sends this email when that order has been paid for, and not before." })],
    documents: [],
    scenarios: []
  };
  for (const prompt of ["the", "and what about this one", "that has been done, not before", "can you do it for them"]) {
    assert.equal(idsFrom(routeContext(fixture, { prompt })).has("CLM-wordy"), false, `"${prompt}" holds no topic word`);
  }
  assert.ok(idsFrom(routeContext(fixture, { prompt: "the queue" })).has("CLM-wordy"), "a real word beside the filler still matches");
});

test("one word found only in a statement is not enough, two are", () => {
  // Statements are prose. A single shared word such as "read" or "first" is
  // usually an accident, and each accident used to send a whole claim.
  const fixture = {
    claims: [claim({ id: "CLM-prose", title: "Table lock", statement: "Every page load will read the bookings table first." })],
    documents: [],
    scenarios: []
  };
  const routes = prompt => idsFrom(routeContext(fixture, { prompt })).has("CLM-prose");
  assert.equal(routes("read that file"), false, "one word from the statement");
  assert.equal(routes("read the first line"), true, "two words from the statement");
  assert.equal(routes("explain lock"), true, "one word from the title");
});

test("words in a claim's detail count like words in its statement", () => {
  // A statement is shortened by moving its evidence into `detail`. Every
  // prompt that found the long statement has to find the short one, or
  // shortening a ledger would quietly lose retrievals.
  const long = "Every page load will read the bookings table first. Measured on the replica: forty seconds behind one vacuum.";
  const before = { claims: [claim({ id: "CLM-prose", title: "Table lock", statement: long })], documents: [], scenarios: [] };
  const after = { claims: [claim({ id: "CLM-prose", title: "Table lock", statement: "Set a timeout before any change.", detail: long })], documents: [], scenarios: [] };
  for (const prompt of ["read that file", "read the first line", "replica vacuum", "explain lock", "timeout"]) {
    assert.equal(idsFrom(routeContext(after, { prompt })).has("CLM-prose"), idsFrom(routeContext(before, { prompt })).has("CLM-prose"), `"${prompt}" routes as it did before the text moved`);
  }
  assert.equal(idsFrom(routeContext(after, { prompt: "replica vacuum" })).has("CLM-prose"), true, "two words found only in the detail are a match");
  assert.equal(idsFrom(routeContext(after, { prompt: "vacuum" })).has("CLM-prose"), false, "one is not, as in a statement");
});

test("a path matches at a folder boundary, not in the middle of a name", () => {
  const fixture = {
    claims: [claim({ id: "CLM-app", scope: { topics: ["zzzz"], paths: ["src/app"], entities: [] } })],
    documents: [],
    scenarios: []
  };
  const route = paths => idsFrom(routeContext(fixture, { prompt: "qqq", paths })).has("CLM-app");
  assert.equal(route(["src/app/main.js"]), true, "a file inside the folder");
  assert.equal(route(["src/app"]), true, "the folder itself");
  assert.equal(route(["src"]), true, "a folder that contains it");
  assert.equal(route(["src/application/main.js"]), false, "a sibling whose name only starts the same");
  assert.equal(route(["src/ap"]), false, "half a folder name");
});

test("a file named in the prompt counts as a path", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-file", scope: { topics: ["zzzz"], paths: ["src/jobs/reminders.js"], entities: [] } }),
      claim({ id: "CLM-folder", scope: { topics: ["yyyy"], paths: ["db/migrations"], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const route = prompt => idsFrom(routeContext(fixture, { prompt }));
  assert.ok(route("look at src/jobs/reminders.js again").has("CLM-file"), "a relative path");
  assert.ok(route("open X:\\work\\shop\\src\\jobs\\reminders.js").has("CLM-file"), "an absolute Windows path");
  assert.ok(route("open /home/me/shop/src/jobs/reminders.js.").has("CLM-file"), "an absolute path with a full stop after it");
  assert.ok(route("why does reminders.js send twice").has("CLM-file"), "a bare file name");
  assert.ok(route("change jobs/reminders.js").has("CLM-file"), "the tail of the path");
  assert.ok(route("add db/migrations/0007_notes.sql").has("CLM-folder"), "a file inside a scoped folder");
  assert.equal(route("see the other.js file, e.g. this one").size, 0, "an unrelated file name matches nothing");
  assert.equal(route("rename jobs to tasks").size, 0, "a word that is only a folder name is not a path");
  // The forms tools and people actually write.
  assert.ok(route("look at @src/jobs/reminders.js").has("CLM-file"), "a file mention with @");
  assert.ok(route("@reminders.js sends twice").has("CLM-file"), "a bare file mention with @");
  assert.ok(route("error at src/jobs/reminders.js:42").has("CLM-file"), "a path with a line number");
  assert.ok(route("TypeError at reminders.js:42:7").has("CLM-file"), "a bare name with line and column");
  assert.ok(route("at send (C:\\shop\\src\\jobs\\reminders.js:42:7)").has("CLM-file"), "a Windows stack frame");
  assert.ok(route("at send (/app/src/jobs/reminders.js:42:7)").has("CLM-file"), "a stack frame from another machine");
  assert.ok(route("fix ./db/migrations/0007_notes.sql").has("CLM-folder"), "a path that starts with ./");
  assert.ok(route("see /db/migrations/0007_notes.sql").has("CLM-folder"), "a path written from the project root");
});

test("a path from somewhere else is not this project's folder of the same name", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-docs", scope: { topics: ["zzzz"], paths: ["docs"], entities: [] } }),
      claim({ id: "CLM-empty", scope: { topics: ["yyyy"], paths: [""], entities: [] } }),
      claim({ id: "CLM-slash", scope: { topics: ["xxxx"], paths: ["/"], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const here = tempDir("ledger-paths-");
  mkdirSync(join(here, "docs"));
  writeFileSync(join(here, "docs", "setup.md"), "# Setup\n", "utf8");
  const route = (prompt, options = {}) => idsFrom(routeContext(fixture, { prompt, ...options }));
  assert.ok(route("update docs/setup.md").has("CLM-docs"));
  assert.ok(route("update /docs/setup.md", { root: here }).has("CLM-docs"), "written from the project root, and the file is there");
  assert.equal(route("update /docs/setup.md").size, 0, "the same text where no such file exists is someone else's path");
  assert.ok(route("update ./docs/setup.md").has("CLM-docs"), "written from the current folder");
  assert.ok(route("update @./docs/setup.md").has("CLM-docs"), "the same as a file mention");
  assert.equal(route("cat /usr/share/docs/readme.txt").size, 0, "a system folder that happens to be called docs");
  assert.equal(route("it is in node_modules/foo/docs/x.md").size, 0, "a dependency's docs");
  assert.equal(route("open /etc/hosts").size, 0, "an empty scope path matches nothing, not everything");
  assert.equal(routeContext(fixture, { prompt: "qqq", paths: ["src/a.js"] }).expansionHandles.length, 0, "nor does it match every file read");
  // Inside the project, an absolute path is read from the project root.
  const root = "X:/work/shop";
  assert.ok(route("open X:\\work\\shop\\docs\\setup.md", { root }).has("CLM-docs"), "an absolute path inside the project");
  assert.ok(route("open X:\\work\\shop\\.claude\\worktrees\\a1\\docs\\setup.md", { root }).has("CLM-docs"), "and inside one of its worktrees");
  assert.equal(route("open X:\\work\\other\\docs\\setup.md", { root }).size, 0, "an absolute path in another project");
});

test("a path is read in the forms a stack trace, a worktree and other shells give it", () => {
  const scoped = (id, path) => claim({ id, scope: { topics: ["zzzz"], paths: [path], entities: [] } });
  const fixture = { claims: [scoped("CLM-jobs", "src/jobs/reminders.js"), scoped("CLM-docs", "docs"), scoped("CLM-guides", "docs/guías")], documents: [], scenarios: [] };
  const root = "X:/work/shop";
  const route = prompt => [...idsFrom(routeContext(fixture, { prompt, root }))];
  assert.deepEqual(route("at remind (file:///X:/work/shop/src/jobs/reminders.js:3:5)"), ["CLM-jobs"], "a Node stack frame in this project");
  assert.deepEqual(route("at remind (file:///srv/app/src/jobs/reminders.js:3:5)"), ["CLM-jobs"], "and one from another machine");
  assert.deepEqual(route("see https://example.com/src/jobs/reminders.js"), [], "a web address is still not a file");
  assert.deepEqual(route("fix .claude/worktrees/feat/src/jobs/reminders.js"), ["CLM-jobs"], "a worktree copy, written from the project root");
  assert.deepEqual(route("fix .claude\\worktrees\\feat\\src\\jobs\\reminders.js"), ["CLM-jobs"], "the same with backslashes");
  assert.deepEqual(route("see src/jobs/reminders.js:42-50"), ["CLM-jobs"], "a line range");
  assert.deepEqual(route("open /x/work/shop/docs/readme.md"), ["CLM-docs"], "the project as Git Bash spells it");
  assert.deepEqual(route("open /mnt/x/work/shop/docs/readme.md"), ["CLM-docs"], "and as WSL spells it");
  assert.deepEqual(route("open docs/guías/inicio.md"), ["CLM-docs", "CLM-guides"], "a folder name with accents");
});

test("a pasted log does not hide the path in the question", () => {
  const fixture = { claims: [claim({ id: "CLM-jobs", scope: { topics: ["zzzz"], paths: ["src/jobs/reminders.js"], entities: [] } })], documents: [], scenarios: [] };
  const here = tempDir("ledger-paste-");
  mkdirSync(join(here, "src", "jobs"), { recursive: true });
  const route = prompt => [...idsFrom(routeContext(fixture, { prompt, root: here }))];
  // The same frame 250 times is one thing to look up, not 250.
  const repeated = Array.from({ length: 250 }, () => "at Module._compile (node:internal/modules/cjs/loader:1105:14)").join("\n");
  assert.deepEqual(route(`${repeated}\nwhy is src/jobs slow`), ["CLM-jobs"]);
  // Five thousand different frames: the question is still read, at either end.
  const frames = Array.from({ length: 5000 }, (_, index) => `at run (/srv/app/lib/module${index}.js:1:1)`).join("\n");
  assert.deepEqual(route(`${frames}\nwhy is src/jobs slow`), ["CLM-jobs"], "asked under the log");
  assert.deepEqual(route(`why is src/jobs slow\n${frames}`), ["CLM-jobs"], "asked above the log");
  assert.ok(mentionedPaths(frames, here).length <= 400, "and the log's own paths are bounded");
});

test("a slash in ordinary prose is not a path", () => {
  const scoped = (id, path) => claim({ id, scope: { topics: ["zzzz"], paths: [path], entities: [] } });
  const fixture = {
    claims: [scoped("CLM-client", "client"), scoped("CLM-api", "api"), scoped("CLM-dev", "dev"), scoped("CLM-tmp", "tmp"), scoped("CLM-types", "types/node"), scoped("CLM-docs-api", "docs/api"), scoped("CLM-jobs", "src/jobs/reminders.js")],
    documents: [],
    scenarios: []
  };
  const here = tempDir("ledger-prose-");
  mkdirSync(join(here, "src", "jobs"), { recursive: true });
  mkdirSync(join(here, "client"));
  const route = prompt => [...idsFrom(routeContext(fixture, { prompt, root: here }))];
  for (const prompt of [
    "should we keep the client/server split",
    "use the api/sdk pattern, and/or the other one",
    "redirect to /dev/null",
    "it wrote /tmp/out.log",
    "install @types/node",
    "see www.example.com/docs/api for the rest",
    "about 1/2 of them, or 3/4 on a good day"
  ]) assert.deepEqual(route(prompt), [], prompt);
  // What still counts: a file name with an extension, or something that is
  // really there.
  assert.deepEqual(route("open client/main.js"), ["CLM-client"], "ends in a file name");
  assert.deepEqual(route("what is in src/jobs"), ["CLM-jobs"], "a folder that exists in the project");
});

test("a word in the title or topics outranks the same word deep in a statement", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-a-mentions", title: "Exports are CSV", statement: "Exports are CSV. A refund row inside the window is exported like any other." }),
      claim({ id: "CLM-b-about", title: "Refund window", scope: { topics: ["refund"], paths: [], entities: [] }, statement: "Fourteen days." })
    ],
    documents: [],
    scenarios: []
  };
  assert.equal(routeContext(fixture, { prompt: "refund window" }).expansionHandles.length, 2, "both claims match, or the limit below decides nothing");
  const pack = routeContext(fixture, { prompt: "refund window", limit: 1 });
  assert.deepEqual(pack.expansionHandles, ["CLM-b-about"], "the claim about refunds wins the one slot");
});

test("a pack lists its claims most relevant first, and says which ones always ride along", () => {
  const fixture = {
    claims: [
      claim({ id: "CLM-a-weak", statement: "Deployment and hosting are mentioned in passing." }),
      claim({ id: "CLM-b-strong", scope: { topics: ["deployment", "hosting"], paths: [], entities: [] } }),
      claim({ id: "CLM-c-universal", universal: true }),
      claim({ id: "CLM-d-disputed", state: "contested", scope: { topics: ["quixotic"], paths: [], entities: [] } })
    ],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(fixture, { prompt: "deployment hosting" });
  assert.deepEqual(pack.priority, ["CLM-c-universal", "CLM-b-strong", "CLM-a-weak", "CLM-d-disputed"]);
  assert.deepEqual(pack.standing, ["CLM-c-universal", "CLM-d-disputed"], "universal claims and unmatched open conflicts are standing, not retrieved");
  const disputedMatched = routeContext(fixture, { prompt: "quixotic" });
  assert.deepEqual(disputedMatched.standing, ["CLM-c-universal"], "an open conflict the prompt names is retrieved like any other claim");
});
