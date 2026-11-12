// What actually reaches the agent.
//
// Claude Code caps a hook's context at 10,000 characters. Past that it saves
// the text to a file and shows the agent the first 2,000 characters and a
// path, and nothing asks the agent to open it. A pack that is routed
// correctly and then cut off is a rule the agent never read, so these tests
// are about size and repetition, not about which claims match.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildHookOutput } from "../src/hook.mjs";
import { fit, packCharBudget, renderPack, renderSessionStart, routeContext, semanticIssues } from "../src/ledger.mjs";
import { fixtureConfig, makeProject, tempDir } from "../fixtures/project.mjs";

const harnessCap = 10000;

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

// Thirty claims of about 600 characters that all match the word "alpha":
// eighteen thousand characters of statements, twice what a pack may hold.
// The last three also match "beta", so they are the most relevant, and they
// are last by id on purpose: a pack filled in id order would cut them.
const long = index => `Rule ${index} body. ${"Lorem ipsum dolor sit amet consectetur. ".repeat(15)}`;
const numberOf = id => Number(id.slice(5));
const wordy = Array.from({ length: 30 }, (_, index) => claim({
  id: `CLM-w${String(index + 1).padStart(2, "0")}`,
  title: `Wordy rule ${index + 1}`,
  statement: long(index + 1),
  scope: { topics: index >= 27 ? ["alpha", "beta"] : ["alpha"], paths: [], entities: [] }
}));
const bigLedger = { claims: wordy, documents: [], scenarios: [] };

test("the budget sits under the harness cap", () => {
  assert.ok(packCharBudget < harnessCap);
});

test("a pack never exceeds the budget, and what did not fit is listed by title", () => {
  const pack = routeContext(bigLedger, { prompt: "alpha beta" });
  assert.equal(pack.expansionHandles.length, 24, "the fixture must route a full pack");
  const rendered = renderPack(pack, { displayName: "Test" });
  assert.ok(rendered.text.length <= packCharBudget, `rendered ${rendered.text.length} characters`);
  assert.ok(rendered.full.length >= 8, "most of the budget goes to whole statements");
  // 30 claims match and the cap admits 24. This used to assert 24: the six
  // past the cap were neither named nor counted, so the pack read as complete.
  assert.equal(pack.cut.length, 6, "the fixture must have claims past the cap");
  assert.equal(rendered.full.length + rendered.titled.length + rendered.omitted, 30, "every matching claim is accounted for, the ones past the cap included");
  for (const { id } of pack.cut) {
    assert.ok(rendered.titled.includes(id) && rendered.text.includes(`[${id}] Wordy rule ${numberOf(id)}\n`), `${id} is past the cap and is still named`);
    assert.equal(rendered.full.includes(id), false, `${id} is past the cap and is not given whole`);
  }
  for (const id of rendered.full) assert.ok(rendered.text.includes(`Rule ${numberOf(id)} body.`), `${id} is given whole`);
  for (const id of rendered.titled) {
    assert.ok(rendered.text.includes(`[${id}] Wordy rule ${numberOf(id)}\n`), `${id} is listed by title`);
    assert.equal(rendered.text.includes(`Rule ${numberOf(id)} body.`), false, `${id} is not given whole`);
  }
  assert.match(rendered.text, /expand --claim/, "the pack says how to read a titled claim in full");
});

test("the most relevant claims are the ones given whole", () => {
  const rendered = renderPack(routeContext(bigLedger, { prompt: "alpha beta" }), { displayName: "Test" });
  for (const id of ["CLM-w28", "CLM-w29", "CLM-w30"]) assert.ok(rendered.full.includes(id), `${id} matched two topics and must not be the one cut`);
  assert.equal(rendered.full.includes("CLM-w20"), false, "the fixture must be too big for the pack, or nothing was chosen");
});

test("a short claim uses room a long one could not", () => {
  const ledger = {
    claims: [
      claim({ id: "CLM-a-huge", scope: { topics: ["alpha", "beta", "gamma"], paths: [], entities: [] }, statement: "Huge. ".repeat(300) }),
      claim({ id: "CLM-b-big", scope: { topics: ["alpha", "beta"], paths: [], entities: [] }, statement: "Big. ".repeat(200) }),
      claim({ id: "CLM-c-small", scope: { topics: ["alpha"], paths: [], entities: [] }, statement: "Small rule." })
    ],
    documents: [],
    scenarios: []
  };
  const rendered = renderPack(routeContext(ledger, { prompt: "alpha beta gamma" }), { displayName: "Test", budget: 2400 });
  assert.deepEqual(rendered.full, ["CLM-a-huge", "CLM-c-small"]);
  assert.deepEqual(rendered.titled, ["CLM-b-big"]);
});

test("a claim with detail is sent as its statement, marked, and the detail stays in the ledger", () => {
  const evidence = "Measured on the replica: forty seconds behind one vacuum. ".repeat(40);
  const ledger = {
    claims: [
      claim({ id: "CLM-a-with", scope: { topics: ["alpha"], paths: [], entities: [] }, statement: "Set a timeout before any change.", detail: evidence }),
      claim({ id: "CLM-b-without", scope: { topics: ["alpha"], paths: [], entities: [] }, statement: "Plain rule." })
    ],
    documents: [],
    scenarios: []
  };
  const rendered = renderPack(routeContext(ledger, { prompt: "alpha" }), { displayName: "Test" });
  assert.match(rendered.text, /Set a timeout before any change\. \[\+detail\]\n/);
  assert.match(rendered.text, /Plain rule\.\n/, "a claim without detail carries no mark");
  assert.equal(rendered.text.includes("forty seconds"), false, "the detail itself is never sent");
  assert.equal(rendered.text.split("expand --claim <id>").length, 2, "where to read it is said once");
  assert.ok(rendered.text.length < 600, "2,000 characters of evidence cost the message one line");

  // The line that says where the detail is counts against the budget like
  // any other, and goes only with a marked claim that was given whole.
  const tight = renderPack(routeContext(ledger, { prompt: "alpha" }), { displayName: "Test", budget: 260 });
  assert.ok(tight.text.length <= 260);
  const plain = renderPack(routeContext({ ...ledger, claims: [ledger.claims[1]] }, { prompt: "alpha" }), { displayName: "Test" });
  assert.equal(plain.text.includes("[+detail]"), false);
  assert.equal(plain.text.includes("expand --claim"), false, "a pack with no marked claim does not mention it");
});

test("editing only a claim's detail does not send the claim again", () => {
  // The conversation holds the statement. A change to text it was never
  // sent is not a change to what it knows.
  const own = makeProject();
  const stateRoot = tempDir("ledger-delivery-");
  const run = prompt => context(buildHookOutput("UserPromptSubmit", { session_id: "detail-edit", prompt }, { root: own.root, stateRoot }));
  const edit = change => {
    const path = join(own.root, "context", "claims.json");
    const claims = JSON.parse(readFileSync(path, "utf8"));
    change(claims.find(item => item.id === "CLM-reminders-sent-once"));
    writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");
  };
  assert.match(run("reword reminder email"), /records that it sent before it queues/);
  edit(item => { item.detail = "Found on 2026-03-02: a retry sent the same reminder three times."; });
  const second = run("reword reminder email");
  assert.equal(second.includes("records that it sent before it queues"), false, "not sent whole again");
  assert.equal(second.includes("Changed since"), false, "and not announced as changed");
  assert.match(second, /Given earlier in this session and relevant again[^\n]*`CLM-reminders-sent-once`/);
});

test("titles that do not fit either are counted, never dropped silently", () => {
  const rendered = renderPack(routeContext(bigLedger, { prompt: "alpha beta" }), { displayName: "Test", budget: 700 });
  assert.ok(rendered.text.length <= 700);
  assert.ok(rendered.omitted > 0, "the fixture must overflow even its titles");
  assert.match(rendered.text, new RegExp(`${rendered.omitted} more matched`));
});

test("a claim the session already holds is named, not repeated", () => {
  const pack = routeContext(bigLedger, { prompt: "alpha beta" });
  const first = renderPack(pack, { displayName: "Test" });
  const second = renderPack(pack, { displayName: "Test", known: first.full });
  for (const id of first.full) {
    assert.equal(second.full.includes(id), false, `${id} was already given`);
    assert.equal(second.text.includes(`Rule ${numberOf(id)} body.`), false, `${id} is not repeated`);
  }
  assert.ok(second.text.includes("`CLM-w01`"), "a claim given earlier that matches again is named");
  assert.ok(second.full.length > 0, "the room goes to claims not given yet");
});

test("a standing claim the session already holds is not mentioned again", () => {
  const ledger = {
    claims: [
      claim({ id: "CLM-always", universal: true, statement: "Always applies." }),
      claim({ id: "CLM-matched", scope: { topics: ["alpha"], paths: [], entities: [] }, statement: "Alpha rule." })
    ],
    documents: [],
    scenarios: []
  };
  const pack = routeContext(ledger, { prompt: "alpha" });
  const rendered = renderPack(pack, { displayName: "Test", known: ["CLM-always"] });
  assert.equal(rendered.text.includes("CLM-always"), false, "it was given at session start and is not specific to this prompt");
  assert.ok(rendered.text.includes("Alpha rule."));
  const nothingNew = renderPack(pack, { displayName: "Test", known: ["CLM-always", "CLM-matched"] });
  assert.deepEqual(nothingNew.full, []);
  assert.ok(nothingNew.text.includes("`CLM-matched`"), "the matched claim is still pointed at");
  const silent = renderPack(routeContext(ledger, { prompt: "zzz qqq" }), { displayName: "Test", known: ["CLM-always"] });
  assert.equal(silent.text, "", "with nothing new and nothing matched there is nothing to say");
});

// ---- the hook, on a ledger too big for one pack -------------------------

const project = makeProject({
  extraClaims: Array.from({ length: 40 }, (_, index) => ({
    id: `CLM-x${String(index + 1).padStart(2, "0")}`,
    title: `Extra rule ${index + 1}`,
    statement: long(index + 1),
    universal: index < 4,
    scope: { topics: ["alpha"], paths: index === 39 ? ["src/big"] : [], entities: [] }
  }))
});
const context = output => output?.hookSpecificOutput.additionalContext ?? "";
const hook = (event, input, stateRoot) => buildHookOutput(event, input, { root: project.root, stateRoot });

test("no hook event sends more than the harness cap", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "cap" };
  const outputs = [
    hook("SessionStart", { ...session, source: "startup" }, stateRoot),
    hook("UserPromptSubmit", { ...session, prompt: "alpha reminder email waitlist refund report" }, stateRoot),
    hook("SubagentStart", { ...session, agent_id: "agent-1" }, stateRoot),
    hook("PostToolUse", { ...session, tool_name: "Read", tool_input: { file_path: join(project.root, "src", "big", "file.js") } }, stateRoot)
  ];
  for (const output of outputs) {
    assert.ok(output, "each event has something to send on this ledger");
    assert.ok(context(output).length <= harnessCap, `${output.hookSpecificOutput.hookEventName} sent ${context(output).length} characters`);
  }
});

test("session start gives the standing rules and no guessed matches", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const text = context(hook("SessionStart", { session_id: "baseline", source: "startup" }, stateRoot));
  assert.match(text, /Everything a customer reads is written in Spanish/, "a universal claim, whole");
  assert.match(text, /Two documents give different refund windows/, "an open conflict, whole");
  assert.doesNotMatch(text, /CLM-reminders-sent-once/, "a scoped claim waits for a prompt or a file that needs it");
});

test("a second prompt on the same subject does not repeat the rule", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "repeat" };
  hook("SessionStart", { ...session, source: "startup" }, stateRoot);
  const rule = "records that it sent before it queues";
  const first = context(hook("UserPromptSubmit", { ...session, prompt: "reword reminder email" }, stateRoot));
  assert.ok(first.includes(rule));
  assert.doesNotMatch(first, /Everything a customer reads/, "the universal rule came at session start and is not sent again");
  const second = context(hook("UserPromptSubmit", { ...session, prompt: "make that reminder shorter" }, stateRoot));
  assert.equal(second.includes(rule), false, "the statement is already in the conversation");
  assert.ok(second.includes("`CLM-reminders-sent-once`"), "the agent is pointed back at it");
  assert.ok(second.length < 400, `a reminder, not a pack: ${second.length} characters`);
});

test("a prompt that matches nothing sends nothing", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "quiet" };
  hook("SessionStart", { ...session, source: "startup" }, stateRoot);
  assert.equal(hook("UserPromptSubmit", { ...session, prompt: "ok, continue" }, stateRoot), null);
  assert.equal(hook("UserPromptSubmit", { ...session, prompt: "yes that is what I meant" }, stateRoot), null);
});

test("after a compaction or a clear the session is given everything again", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "compacted" };
  const rule = "records that it sent before it queues";
  const first = context(hook("SessionStart", { ...session, source: "startup" }, stateRoot));
  assert.ok(context(hook("UserPromptSubmit", { ...session, prompt: "reword reminder email" }, stateRoot)).includes(rule));
  for (const source of ["compact", "clear"]) {
    assert.equal(context(hook("SessionStart", { ...session, source }, stateRoot)), first, `${source} empties the conversation, so the baseline is sent again`);
    assert.ok(context(hook("UserPromptSubmit", { ...session, prompt: "reword reminder email" }, stateRoot)).includes(rule), `after ${source} the rule is sent whole again`);
  }
});

test("a resumed session is not given the same baseline twice", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "resumed" };
  const rule = "records that it sent before it queues";
  assert.ok(hook("SessionStart", { ...session, source: "startup" }, stateRoot));
  assert.ok(context(hook("UserPromptSubmit", { ...session, prompt: "reword reminder email" }, stateRoot)).includes(rule));
  assert.equal(hook("SessionStart", { ...session, source: "resume" }, stateRoot), null, "a resume restores the conversation, baseline included");
  assert.equal(context(hook("UserPromptSubmit", { ...session, prompt: "reword reminder email" }, stateRoot)).includes(rule), false, "and what was given before the resume still counts as given");
});

test("reading or editing a file brings the claims scoped to it, once", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "tool" };
  hook("SessionStart", { ...session, source: "startup" }, stateRoot);
  const read = path => hook("PostToolUse", { ...session, tool_name: "Read", tool_input: { file_path: path } }, stateRoot);
  const migration = join(project.root, "db", "migrations", "0007_notes.sql");
  const first = context(read(migration));
  assert.match(first, /A bare ALTER TABLE on `orders`/, "the hazard scoped to db/migrations");
  assert.doesNotMatch(first, /Everything a customer reads/, "standing rules are not repeated on a file read");
  assert.doesNotMatch(first, /CLM-reminders-sent-once/, "a claim scoped elsewhere stays out");
  assert.equal(read(migration), null, "the same file again adds nothing");
  assert.equal(read(join(project.root, "db", "migrations", "0008_more.sql")), null, "nor does another file under the same scope");
  assert.equal(read(join(project.root, "README.md")), null, "a file no claim is scoped to");
  assert.equal(read(join(project.root, "..", "elsewhere", "db", "migrations", "x.sql")), null, "a file outside the project");
  assert.equal(hook("PostToolUse", { ...session, tool_name: "Bash", tool_input: { command: "ls" } }, stateRoot), null, "a tool call with no file");
  const notebook = hook("PostToolUse", { ...session, tool_name: "NotebookEdit", tool_input: { notebook_path: join(project.root, "src", "waitlist", "notes.ipynb") } }, stateRoot);
  assert.ok(context(notebook).includes("never books for them"), "a notebook edit names its file in notebook_path");
});

test("a claim given on a file read is not sent again by a later prompt", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "tool-then-prompt" };
  hook("SessionStart", { ...session, source: "startup" }, stateRoot);
  hook("PostToolUse", { ...session, tool_name: "Edit", tool_input: { file_path: join(project.root, "db", "migrations", "0007_notes.sql") } }, stateRoot);
  const text = context(hook("UserPromptSubmit", { ...session, prompt: "is that migration safe for the schema" }, stateRoot));
  assert.doesNotMatch(text, /A bare ALTER TABLE/);
  assert.ok(text.includes("`CLM-orders-table-lock`"));
});

test("a subagent starts with nothing, whatever the main session holds", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "subagent" };
  hook("SessionStart", { ...session, source: "startup" }, stateRoot);
  const migration = join(project.root, "db", "migrations", "0007_notes.sql");
  assert.ok(hook("PostToolUse", { ...session, tool_name: "Read", tool_input: { file_path: migration } }, stateRoot), "the main session reads the file");
  const started = context(hook("SubagentStart", { ...session, agent_id: "agent-7" }, stateRoot));
  assert.match(started, /Everything a customer reads/, "the subagent gets the standing rules whole");
  const inside = input => hook("PostToolUse", { ...session, agent_id: "agent-7", tool_name: "Read", tool_input: input }, stateRoot);
  assert.match(context(inside({ file_path: migration })), /A bare ALTER TABLE/, "its own conversation has not seen the hazard");
  assert.equal(inside({ file_path: migration }), null, "and then it has");
  // The other direction: what a subagent was given, the main session was not.
  const waitlist = join(project.root, "src", "waitlist", "page.js");
  assert.match(context(inside({ file_path: waitlist })), /never books for them/);
  const main = hook("PostToolUse", { ...session, tool_name: "Read", tool_input: { file_path: waitlist } }, stateRoot);
  assert.match(context(main), /never books for them/, "the main conversation still needs the claim its subagent read");
});

test("a file read sends only claims scoped to the file, even in a session that never got its baseline", () => {
  // The hook was registered mid-session, or the start-up message was lost.
  // The standing claims then go out with the next prompt, not beside a file.
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "no-baseline" };
  assert.equal(hook("PostToolUse", { ...session, tool_name: "Read", tool_input: { file_path: join(project.root, "README.md") } }, stateRoot), null);
  const scoped = context(hook("PostToolUse", { ...session, tool_name: "Read", tool_input: { file_path: join(project.root, "db", "migrations", "0007_notes.sql") } }, stateRoot));
  assert.match(scoped, /A bare ALTER TABLE/);
  assert.doesNotMatch(scoped, /Everything a customer reads/);
  assert.match(context(hook("UserPromptSubmit", { ...session, prompt: "ok, continue" }, stateRoot)), /Everything a customer reads/, "the next prompt carries the standing claims");
});

// ---- a ledger with many standing claims, and many claims on one folder ---

const crowded = makeProject({
  extraClaims: [
    ...Array.from({ length: 18 }, (_, index) => ({ id: `CLM-standing-${index}`, title: `Standing rule ${index}`, statement: `Standing rule ${index} body.`, universal: true })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `CLM-crowd-${index}`, title: `Crowd rule ${index}`, statement: `Crowd rule ${index} body.`, scope: { topics: [], paths: ["src/crowd"], entities: [] } })),
    ...Array.from({ length: 30 }, (_, index) => ({ id: `CLM-many-${String(index).padStart(2, "0")}`, title: `Many rule ${index}`, statement: `Many rule ${index} body.`, scope: { topics: [], paths: ["src/many"], entities: [] } })),
    { id: "CLM-standing-on-a-file", title: "Standing rule about one folder", statement: "Standing rule about one folder, body.", universal: true, scope: { topics: [], paths: ["src/uni"], entities: [] } }
  ]
});
const crowdedHook = (event, input, stateRoot) => buildHookOutput(event, input, { root: crowded.root, stateRoot });
const crowdedRead = (session, stateRoot, ...parts) => context(crowdedHook("PostToolUse", { ...session, tool_name: "Read", tool_input: { file_path: join(crowded.root, ...parts) } }, stateRoot));

test("a session full of standing claims still has room for a file's own claims", () => {
  // The cap on a pack is 24 claims. The standing claims used to count
  // against it on every event, so a file read here had room for two.
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "crowded" };
  assert.ok(crowdedHook("SessionStart", { ...session, source: "startup" }, stateRoot));
  const text = crowdedRead(session, stateRoot, "src", "crowd", "a.js");
  for (let index = 0; index < 5; index += 1) assert.ok(text.includes(`Crowd rule ${index} body.`), `claim ${index} scoped to the folder`);
  assert.doesNotMatch(text, /Standing rule \d+ body/);
  // The same in a session that never got its standing claims: they are held
  // back for the next prompt, and must not take the file's room meanwhile.
  const late = crowdedRead({ session_id: "crowded-no-baseline" }, stateRoot, "src", "crowd", "a.js");
  for (let index = 0; index < 5; index += 1) assert.ok(late.includes(`Crowd rule ${index} body.`), `claim ${index}, with no baseline`);
});

test("claims the cap leaves out of a file read are named, not dropped in silence", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "many" };
  crowdedHook("SessionStart", { ...session, source: "startup" }, stateRoot);
  const text = crowdedRead(session, stateRoot, "src", "many", "a.js");
  assert.equal((text.match(/Many rule \d+ body\./g) ?? []).length, 24, "a full pack of the folder's claims");
  assert.equal((text.match(/^- \[CLM-many-\d+\] Many rule \d+$/gm) ?? []).length, 6, "the six past the cap, by title");
  const next = crowdedRead(session, stateRoot, "src", "many", "b.js");
  assert.equal((next.match(/Many rule \d+ body\./g) ?? []).length, 6, "the next file under the folder brings the rest");
});

test("a standing claim scoped to the file is sent with it when the conversation never had it", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "no-baseline-uni" };
  const text = crowdedRead(session, stateRoot, "src", "uni", "a.js");
  assert.match(text, /Standing rule about one folder, body\./);
  assert.doesNotMatch(text, /Standing rule \d+ body/, "the other standing claims still wait for a prompt");
  const started = { session_id: "baseline-uni" };
  crowdedHook("SessionStart", { ...started, source: "startup" }, stateRoot);
  assert.equal(crowdedHook("PostToolUse", { ...started, tool_name: "Read", tool_input: { file_path: join(crowded.root, "src", "uni", "a.js") } }, stateRoot), null, "a session that got it at the start is not sent it again");
});

test("a file in a subagent's worktree is the same file", () => {
  // A session in the main checkout starts a subagent in
  // <project>/.claude/worktrees/<name>; the hook still runs for the project.
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "worktree", agent_id: "agent-w" };
  const text = context(hook("PostToolUse", { ...session, tool_name: "Edit", tool_input: { file_path: join(project.root, ".claude", "worktrees", "agent-w", "db", "migrations", "0007_notes.sql") } }, stateRoot));
  assert.match(text, /A bare ALTER TABLE/);
  assert.match(text, /routed context for db\/migrations\/0007_notes\.sql/);
});

test("a claim reworded in the middle of a session is sent again, and said to have changed", () => {
  const own = makeProject();
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "reworded" };
  const run = (event, input) => context(buildHookOutput(event, { ...session, ...input }, { root: own.root, stateRoot }));
  run("SessionStart", { source: "startup" });
  assert.ok(run("UserPromptSubmit", { prompt: "reword reminder email" }).includes("records that it sent before it queues"));
  const path = join(own.root, "context", "claims.json");
  const claims = JSON.parse(readFileSync(path, "utf8"));
  claims.find(item => item.id === "CLM-reminders-sent-once").statement = "Reminder emails are paused until the queue is replaced.";
  writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");
  const second = run("UserPromptSubmit", { prompt: "make that reminder shorter" });
  assert.ok(second.includes("Reminder emails are paused until the queue is replaced."), "the new wording, whole");
  assert.match(second, /Changed since it was given earlier in this session[^\n]*`CLM-reminders-sent-once`/);
  const third = run("UserPromptSubmit", { prompt: "and the reminder subject line" });
  assert.equal(third.includes("paused until the queue"), false, "the new wording is now what the conversation holds");
  assert.ok(third.includes("`CLM-reminders-sent-once`"));
});

test("a subagent start with no agent id leaves the main conversation's record alone", () => {
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "anonymous-subagent" };
  hook("SessionStart", { ...session, source: "startup" }, stateRoot);
  assert.ok(context(hook("UserPromptSubmit", { ...session, prompt: "reword reminder email" }, stateRoot)).includes("records that it sent before it queues"));
  const migration = { ...session, tool_name: "Read", tool_input: { file_path: join(project.root, "db", "migrations", "0007_notes.sql") } };
  assert.match(context(hook("PostToolUse", migration, stateRoot)), /A bare ALTER TABLE/);
  assert.match(context(hook("SubagentStart", session, stateRoot)), /Everything a customer reads/);
  const again = context(hook("UserPromptSubmit", { ...session, prompt: "make that reminder shorter" }, stateRoot));
  assert.equal(again.includes("records that it sent before it queues"), false, "the main conversation still holds what a prompt gave it");
  assert.equal(hook("PostToolUse", migration, stateRoot), null, "and what a file read gave it");
});

test("a record that cannot be written does not cost the session its message", () => {
  // A folder where the state file should be: reading it fails, and so does
  // every way of writing it.
  const stateRoot = tempDir("ledger-delivery-");
  mkdirSync(join(stateRoot, "locked.json"));
  assert.match(context(hook("SessionStart", { session_id: "locked", source: "startup" }, stateRoot)), /Everything a customer reads/);
  assert.match(context(hook("UserPromptSubmit", { session_id: "locked", prompt: "reword reminder email" }, stateRoot)), /records that it sent before it queues/);
});

test("the pointer to claims already given never crowds out a new one", () => {
  // A long session on a large ledger: 276 claims held, 24 new, and a prompt
  // that matches all 300. Naming every held one took the whole message.
  const many = Array.from({ length: 300 }, (_, index) => claim({ id: `CLM-n${String(index).padStart(3, "0")}`, title: `N${index}`, statement: `N${index} body.`, scope: { topics: ["alpha"], paths: [], entities: [] } }));
  const ledger = { claims: many, documents: [], scenarios: [] };
  const known = many.slice(0, 276).map(item => item.id);
  const rendered = renderPack(routeContext(ledger, { prompt: "alpha", free: known }), { displayName: "Test", known });
  assert.equal(rendered.full.length, 24, "every new claim is given whole");
  assert.ok(rendered.text.length <= packCharBudget, `rendered ${rendered.text.length} characters`);
  assert.match(rendered.text, /relevant again: (`CLM-n\d+`, ){7}`CLM-n\d+` and 268 more\n/, "eight held claims are named and the rest counted");
});

test("a claim is never both whole and listed by title", () => {
  const pack = routeContext({ claims: [claim({ id: "CLM-both", title: "Both", statement: "Both, body.", universal: true })], documents: [], scenarios: [] });
  const rendered = renderPack({ ...pack, cut: [{ id: "CLM-both", title: "Both" }] }, { displayName: "Test" });
  assert.deepEqual(rendered.full, ["CLM-both"]);
  assert.deepEqual(rendered.titled, []);
  assert.equal(rendered.omitted, 0);
});

test("a claim superseded in the middle of a session is withdrawn, once, and not passed to a subagent", () => {
  const own = makeProject();
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "superseded" };
  const run = (event, input) => context(buildHookOutput(event, { ...session, ...input }, { root: own.root, stateRoot }));
  run("SessionStart", { source: "startup" });
  assert.ok(run("UserPromptSubmit", { prompt: "reword reminder email" }).includes("records that it sent before it queues"));
  const path = join(own.root, "context", "claims.json");
  const claims = JSON.parse(readFileSync(path, "utf8"));
  claims.find(item => item.id === "CLM-reminders-sent-once").state = "superseded";
  writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");
  const started = run("SubagentStart", { agent_id: "agent-s" });
  assert.match(started, /Everything a customer reads/);
  assert.equal(started.includes("records that it sent before it queues"), false, "the subagent is not handed the superseded rule");
  const told = run("PostToolUse", { tool_name: "Read", tool_input: { file_path: join(own.root, "README.md") } });
  assert.match(told, /No longer in force[^\n]*`CLM-reminders-sent-once`/, "the conversation that holds it is told at the next event");
  assert.equal(buildHookOutput("UserPromptSubmit", { ...session, prompt: "ok, continue" }, { root: own.root, stateRoot }), null, "and only once");
});

test("a resume does not repeat the standing claims because the repository line changed", () => {
  // The line under the claims counts claims and reports the worktree, so it
  // changes with every edit. Only the claims decide whether a resume repeats.
  const own = makeProject();
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "resume-after-edit" };
  const start = buildHookOutput("SessionStart", { ...session, source: "startup" }, { root: own.root, stateRoot });
  const path = join(own.root, "context", "claims.json");
  const claims = JSON.parse(readFileSync(path, "utf8"));
  claims.push({ ...claims.find(item => item.id === "CLM-reminders-sent-once"), id: "CLM-added-later", universal: false, state: "accepted", relationships: [] });
  writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");
  const fresh = buildHookOutput("SessionStart", { session_id: "another", source: "startup" }, { root: own.root, stateRoot });
  assert.notEqual(context(fresh), context(start), "the fixture must change the line under the claims");
  assert.equal(buildHookOutput("SessionStart", { ...session, source: "resume" }, { root: own.root, stateRoot }), null);
});

test("a damaged record counts as empty instead of silencing the hook", () => {
  const stateRoot = tempDir("ledger-delivery-");
  writeFileSync(join(stateRoot, "damaged.json"), JSON.stringify({ known: [null, 7, { id: "x" }, "", "not-a-claim"] }), "utf8");
  const sent = context(hook("UserPromptSubmit", { session_id: "damaged", prompt: "reword reminder email" }, stateRoot));
  assert.match(sent, /records that it sent before it queues/);
  assert.equal(sent.includes("No longer in force"), false, "and junk in it is not announced as a withdrawn claim");
});

test("a resume is sent only what changed while the session was away", () => {
  const own = makeProject();
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "resume-after-change" };
  const run = (event, input) => context(buildHookOutput(event, { ...session, ...input }, { root: own.root, stateRoot }));
  const edit = change => {
    const path = join(own.root, "context", "claims.json");
    const claims = JSON.parse(readFileSync(path, "utf8"));
    change(claims.find(item => item.id === "CLM-refund-window"));
    writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");
  };
  assert.match(run("SessionStart", { source: "startup" }), /Everything a customer reads/);
  edit(item => { item.statement = "The refund window is between fourteen and thirty days, and the owner has not chosen."; });
  const resumed = run("SessionStart", { source: "resume" });
  assert.ok(resumed.includes("between fourteen and thirty days"), "the reworded standing claim, whole");
  assert.match(resumed, /Changed since it was given earlier in this session[^\n]*`CLM-refund-window`/);
  assert.equal(resumed.includes("Everything a customer reads"), false, "the standing claim that did not change is not sent again");
  assert.equal(run("SessionStart", { source: "resume" }), "", "a second resume has nothing new");
  edit(item => { item.state = "superseded"; });
  assert.match(run("SessionStart", { source: "resume" }), /No longer in force[^\n]*`CLM-refund-window`/, "a standing claim withdrawn meanwhile is said to be");
  assert.equal(run("SessionStart", { source: "resume" }), "", "once");
});

test("a file that is not there yet is still inside the project when the project has two spellings", () => {
  // A CI runner's temp folder and a linked checkout both give one folder two
  // spellings. The file a tool names may not exist (a read that failed, a
  // path about to be written), so its real spelling has to be taken from the
  // nearest folder that does exist. Compared as typed, the file looks like
  // it is outside the project and its claims are never sent.
  const stateRoot = tempDir("ledger-delivery-");
  const link = join(tempDir("ledger-link-"), "project");
  symlinkSync(project.root, link, "junction");
  try {
    const read = { session_id: "linked", tool_name: "Read", tool_input: { file_path: join(link, "db", "migrations", "0007_notes.sql") } };
    assert.match(context(hook("PostToolUse", read, stateRoot)), /A bare ALTER TABLE/);
  } finally {
    // The link only, never what it points at.
    try { unlinkSync(link); } catch { rmdirSync(link); }
  }
});

test("a ledger registered for another project reads that project's files and names its own command", () => {
  // A shared ledger: its hook is registered in the user's settings, and the
  // session works somewhere else. The claims come from the ledger. The files
  // are the session's.
  const home = makeProject();
  const guest = tempDir("ledger-guest-");
  const stateRoot = tempDir("ledger-delivery-");
  const run = (event, input, project = guest) => context(buildHookOutput(event, { session_id: "guest", ...input }, { root: home.root, stateRoot, project }));
  const path = join(home.root, "context", "claims.json");
  const claims = JSON.parse(readFileSync(path, "utf8"));
  claims.find(item => item.id === "CLM-orders-table-lock").detail = "Seen once: four minutes behind one ALTER.";
  writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");

  const read = run("PostToolUse", { tool_name: "Read", tool_input: { file_path: join(guest, "db", "migrations", "0001_init.sql") } });
  assert.match(read, /A bare ALTER TABLE/, "a path in the session's project is matched against the claim's scope");
  const cli = join(home.root, "tools", "context-ledger", "src", "cli.mjs").replaceAll("\\", "/");
  assert.ok(read.includes(`node "${cli}" expand --claim <id>`), "the command to read a claim names the ledger's own tool, since the session is not in its folder");
  assert.equal(run("PostToolUse", { tool_name: "Read", tool_input: { file_path: join(home.root, "db", "migrations", "0001_init.sql") } }), "", "a file in the ledger's own folder is outside the session's project");
  assert.match(run("UserPromptSubmit", { session_id: "guest-2", prompt: "reword reminder email" }), /records that it sent before it queues/);
});

test("a shared ledger speaks only in the projects it applies to", () => {
  const home = makeProject();
  writeFileSync(join(home.root, "context", "ledger.config.json"), JSON.stringify({ ...fixtureConfig, appliesTo: ["*.uproject"] }), "utf8");
  const stateRoot = tempDir("ledger-delivery-");
  const says = project => context(buildHookOutput("UserPromptSubmit", { session_id: `applies-${Math.random()}`, prompt: "reword reminder email" }, { root: home.root, stateRoot, project })) !== "";
  const game = tempDir("ledger-game-");
  writeFileSync(join(game, "Arcade.uproject"), "{}", "utf8");
  mkdirSync(join(game, "Source", "Arcade"), { recursive: true });
  const shelf = tempDir("ledger-shelf-");
  mkdirSync(join(shelf, "GameTwo"));
  writeFileSync(join(shelf, "GameTwo", "GameTwo.UPROJECT"), "{}", "utf8");
  const other = tempDir("ledger-other-");
  writeFileSync(join(other, "package.json"), "{}", "utf8");

  assert.equal(says(game), true, "the project folder holds a matching file");
  assert.equal(says(join(game, "Source", "Arcade")), true, "a session started in a subfolder of the project");
  assert.equal(says(shelf), true, "a session started in the folder that holds the projects");
  assert.equal(says(other), false, "a project of another kind is not its concern");
  assert.equal(says(home.root), true, "and its own project is never filtered");
  assert.equal(says(null), true, "nor a caller that does not say where the session is");
});

test("the hook drops the ledger's ignored words from a prompt", () => {
  const own = makeProject();
  const stateRoot = tempDir("ledger-delivery-");
  const says = (session, prompt) => context(buildHookOutput("UserPromptSubmit", { session_id: session, prompt }, { root: own.root, stateRoot }));
  assert.match(says("ignore-before", "the reminder"), /records that it sent before it queues/);
  writeFileSync(join(own.root, "context", "ledger.config.json"), JSON.stringify({ ...fixtureConfig, ignoreWords: ["reminder"] }), "utf8");
  // A new conversation is still sent the standing claims, so the message is
  // not empty. The claim the prompt would have chosen is not in it.
  assert.equal(says("ignore-after", "the reminder").includes("records that it sent before it queues"), false, "the only word that matched is one the ledger ignores");
});

test("a message fits even when ids alone would fill it", () => {
  // The schema puts no limit on the length of an id, and the lines that name
  // claims by id are not built claim by claim.
  const held = Array.from({ length: 8 }, (_, index) => claim({ id: `CLM-${"x".repeat(1500)}-${index}`, title: `Held ${index}`, scope: { topics: ["alpha"], paths: [], entities: [] } }));
  const ledger = { claims: [...held, claim({ id: "CLM-new", title: "New", statement: "New, body.", scope: { topics: ["alpha"], paths: [], entities: [] } })], documents: [], scenarios: [] };
  const known = held.map(item => item.id);
  const rendered = renderPack(routeContext(ledger, { prompt: "alpha", free: known }), { displayName: "Test", known });
  assert.ok(rendered.text.length <= packCharBudget, `rendered ${rendered.text.length} characters`);
  assert.match(rendered.text, /New, body\./, "what is new is still given whole");
  assert.match(rendered.text, /relevant again: 8 claims, with ids too long to list here\n/);
});

test("whatever is still too long is cut at a line, and says so", () => {
  assert.equal(fit("short\n"), "short\n");
  const cut = fit("a line of text\n".repeat(2000));
  assert.ok(cut.length <= packCharBudget, `${cut.length} characters`);
  assert.match(cut, /a line of text\n\(Cut here: the rest did not fit in one message\.\)\n$/);
  // The hook applies it to every message. A record can name ids of any
  // length, and the line that withdraws them is not built claim by claim.
  const stateRoot = tempDir("ledger-delivery-");
  const known = Array.from({ length: 8 }, (_, index) => `CLM-${"y".repeat(1500)}-${index} ${"0".repeat(12)}`);
  writeFileSync(join(stateRoot, "long-ids.json"), JSON.stringify({ known }), "utf8");
  const sent = context(hook("UserPromptSubmit", { session_id: "long-ids", prompt: "reword reminder email" }, stateRoot));
  assert.ok(sent.length > 0 && sent.length <= packCharBudget, `sent ${sent.length} characters`);
  assert.match(context(hook("UserPromptSubmit", { session_id: "long-ids", prompt: "reword reminder email" }, stateRoot)), /records that it sent before it queues/, "and the next message is whole again");
});

test("a withdrawn claim with hundreds of successors is still one short line", () => {
  const own = makeProject();
  const stateRoot = tempDir("ledger-delivery-");
  const session = { session_id: "many-successors" };
  const run = (event, input) => context(buildHookOutput(event, { ...session, ...input }, { root: own.root, stateRoot }));
  run("SessionStart", { source: "startup" });
  assert.ok(run("UserPromptSubmit", { prompt: "reword reminder email" }).includes("records that it sent before it queues"));
  const path = join(own.root, "context", "claims.json");
  const claims = JSON.parse(readFileSync(path, "utf8"));
  const old = claims.find(item => item.id === "CLM-reminders-sent-once");
  old.state = "superseded";
  for (let index = 0; index < 400; index += 1) claims.push({ ...old, id: `CLM-next-${String(index).padStart(3, "0")}`, state: "accepted", relationships: [{ type: "supersedes", target: old.id }] });
  writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");
  const told = run("UserPromptSubmit", { prompt: "reword reminder email" });
  assert.ok(told.length <= packCharBudget, `sent ${told.length} characters`);
  assert.match(told, /No longer in force[^\n]*`CLM-reminders-sent-once` \(replaced by `CLM-next-\d+`, `CLM-next-\d+` and 398 more\)/);
});

test("files read in parallel are all recorded, so none of their claims is sent twice", async () => {
  // Claude Code runs the tool calls of one step at the same time, and one
  // copy of the hook for each. Each copy used to write the record it had read
  // at its start over what the others had just written.
  const files = Array.from({ length: 12 }, (_, index) => `src/parallel/file${index}.js`);
  // The hook finds its project from where its own file is, so it runs from a
  // copy installed in the fixture project, and keeps its records in a temp
  // folder of this test's. It is told the session is in that project: run
  // from inside a Claude Code hook, this test inherits the real session's
  // CLAUDE_PROJECT_DIR, and the hook would read the files against that.
  const own = makeProject({ install: true, extraClaims: files.map((path, index) => ({ id: `CLM-parallel-${index}`, title: `Parallel ${index}`, statement: `Parallel rule ${index}, body.`, scope: { topics: [], paths: [path], entities: [] } })) });
  const temp = tempDir("ledger-parallel-");
  const script = realpathSync.native(join(dirname(own.cli), "hook.mjs"));
  const read = path => new Promise((done, failed) => {
    const child = spawn(process.execPath, [script, "PostToolUse"], { env: { ...process.env, CLAUDE_PROJECT_DIR: own.root, TEMP: temp, TMP: temp, TMPDIR: temp }, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", chunk => { out += chunk; });
    child.on("error", failed);
    child.on("close", () => done(out));
    child.stdin.end(JSON.stringify({ session_id: "parallel", tool_name: "Read", tool_input: { file_path: join(own.root, path) } }));
  });
  const first = await Promise.all(files.map(read));
  assert.equal(first.filter(out => /Parallel rule \d+, body\./.test(out)).length, 12, "every read brought its claim");
  const second = await Promise.all(files.map(read));
  assert.deepEqual(second.filter(Boolean), [], "and reading the same files again brings nothing");
});

test("validate does not fall over on a ledger the schema already rejected", () => {
  // It used to: the standing-claims check routed a claim with no statement
  // and threw, so the run ended in a stack trace instead of the schema error.
  const broken = [claim({ id: "CLM-no-statement", statement: undefined, universal: true }), claim({ id: "CLM-number-path", statement: "A rule.", scope: { topics: [], paths: [7], entities: [] } })];
  let issues;
  assert.doesNotThrow(() => { issues = semanticIssues({ claims: broken, documents: [], scenarios: [] }); });
  assert.ok(Array.isArray(issues));
});

test("validate measures the standing claims against what a session start can hold", () => {
  // Nine claims of 930 characters fit 9,000 and do not fit beside the two
  // lines a session start adds. The warning and the hook must agree.
  const standing = Array.from({ length: 9 }, (_, index) => claim({ id: `CLM-s${index}`, title: `S${index}`, statement: `S${index} ${"x".repeat(927)}`, universal: true }));
  const ledger = { claims: standing, documents: [], scenarios: [] };
  assert.ok(renderPack(routeContext(ledger), { displayName: "Test" }).titled.length === 0, "the fixture fits a plain pack");
  assert.ok(renderSessionStart(ledger, { displayName: "Test" }).titled.length > 0, "and does not fit a session start");
  assert.ok(semanticIssues(ledger).some(issue => issue.code === "standing-overflow"));
});
