// A small invented project with a populated ledger, built in a temp folder.
//
// The package's tests run against this, not against the project the package
// is copied into. Tests that read the host project's own ledger pass in one
// repository and fail in the next, because they pin claim ids that only exist
// in the first.
//
// This file is deliberately outside test/: Node runs every script under a
// test/ folder as a test file.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAnchor, stableJson } from "../src/ledger.mjs";

export const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const fixtureConfig = { repository: "fixture-shop", displayName: "Fixture Shop" };

const at = "2026-01-15T00:00:00Z";
const event = (from, to, actor = "session") => ({ from, to, at, actor, source: "fixture" });
const unresolved = `sha256:${"0".repeat(64)}`;

// Every temp folder a test makes goes through here and is removed when the
// test process exits. Several hold a copy of node_modules, and a suite that
// leaves them behind fills the temp drive a few megabytes per run.
const created = [];
process.on("exit", () => {
  for (const folder of created) {
    try { rmSync(folder, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

export function tempDir(prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  created.push(folder);
  return folder;
}

function write(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

// The hash is read back from the file just written, so the anchor is current
// by construction and no hash is typed by hand.
function anchor(root, path, locator, verification = { kind: "inspection" }) {
  const resolved = resolveAnchor({ path, locator, normalizedContentHash: unresolved }, root);
  if (!resolved.actualHash) throw new Error(`fixture anchor did not resolve: ${path}: ${resolved.reason}`);
  return { path, locator, normalizedContentHash: resolved.actualHash, displayLine: resolved.line, verifiedAtCommit: "abc1234", verification };
}

function claim(overrides) {
  return {
    title: "Fixture claim",
    kind: "fact",
    state: "accepted",
    authority: { kind: "session", source: "fixture" },
    scope: { topics: [], paths: [], entities: [] },
    universal: false,
    severity: "medium",
    relationships: [],
    evidence: [],
    history: [event(null, "accepted")],
    ...overrides
  };
}

/**
 * Build the fixture project and return its root.
 *
 * `install: true` also copies this package to <root>/tools/context-ledger,
 * which is where the CLI must sit to find the project: it has no --root flag
 * outside `init` and resolves the project three folders above its own file.
 */
export function makeProject({ install = false } = {}) {
  const root = tempDir("ledger-fixture-");

  write(root, "README.md", "# Fixture Shop\n\nAn invented project for the ledger's tests.\n");
  write(root, "docs/runbook.md", "# Runbook\n\n## Schema changes\nSet a lock timeout before altering the orders table.\n\n## Releases\nTag, then deploy.\n");
  write(root, "src/jobs/reminders.js", "export function remind(order) {\n  if (order.reminderSentAt) return;\n  send(order);\n}\n");
  write(root, "src/reports/nightly.js", "export const nightly = () => 'report';\n");

  const claims = [
    claim({
      id: "CLM-copy-language",
      title: "Customer text is Spanish, code is English",
      statement: "Everything a customer reads is written in Spanish. Code, comments and commit messages are English.",
      kind: "invariant",
      authority: { kind: "user", source: "fixture" },
      scope: { topics: ["copy", "language", "translation"], paths: [], entities: [] },
      universal: true,
      severity: "critical",
      history: [event(null, "accepted", "user")]
    }),
    claim({
      id: "CLM-orders-table-lock",
      title: "A bare ALTER on the orders table blocks every read",
      statement: "A bare ALTER TABLE on `orders` queues every read behind it. Set a lock timeout and retry.",
      kind: "hazard",
      state: "verified",
      authority: { kind: "implementation", source: "docs/runbook.md" },
      scope: { topics: ["migration", "schema", "lock"], paths: ["db/migrations"], entities: ["orders"] },
      severity: "critical",
      evidence: [anchor(root, "docs/runbook.md", { kind: "heading", value: "Schema changes" })],
      history: [event(null, "accepted"), event("accepted", "verified")]
    }),
    claim({
      id: "CLM-reminders-sent-once",
      title: "A reminder is sent once per order",
      statement: "The reminder job records that it sent before it queues, and skips any order already marked.",
      kind: "invariant",
      state: "enforced",
      authority: { kind: "implementation", source: "src/jobs/reminders.js" },
      scope: { topics: ["reminder", "email", "duplicate"], paths: ["src/jobs/reminders.js", "src/emails"], entities: ["reminderSentAt"] },
      severity: "high",
      evidence: [anchor(
        root,
        "src/jobs/reminders.js",
        { kind: "excerpt", value: "if (order.reminderSentAt) return;" },
        { kind: "test", command: `"${process.execPath}" -e "process.exit(0)"`, test: "exit zero" }
      )],
      history: [event(null, "accepted"), event("accepted", "enforced")]
    }),
    // Superseded, and its evidence is stale on purpose: a superseded claim's
    // drift must not count against the ledger's health.
    claim({
      id: "CLM-nightly-report-untested",
      title: "The nightly report has no tests",
      statement: "The nightly report job runs without any test coverage.",
      state: "superseded",
      scope: { topics: ["report", "nightly", "tests"], paths: ["src/reports"], entities: [] },
      evidence: [{
        path: "src/reports/nightly.js",
        locator: { kind: "file", value: "" },
        normalizedContentHash: `sha256:${"1".repeat(64)}`,
        displayLine: 1,
        verifiedAtCommit: "abc1234",
        verification: { kind: "inspection" }
      }],
      history: [event(null, "accepted"), event("accepted", "superseded")]
    }),
    claim({
      id: "CLM-nightly-report-tested",
      title: "The nightly report is covered by tests",
      statement: "The nightly report job has tests and they run on every push.",
      state: "enforced",
      scope: { topics: ["report", "nightly", "tests"], paths: ["src/reports"], entities: [] },
      relationships: [{ type: "supersedes", target: "CLM-nightly-report-untested" }],
      history: [event(null, "accepted"), event("accepted", "enforced")]
    }),
    claim({
      id: "CLM-waitlist-undecided",
      title: "Waitlist behaviour is undecided",
      statement: "Whether a waitlist customer is booked automatically or only notified was not decided.",
      kind: "conflict",
      state: "superseded",
      scope: { topics: ["waitlist", "notify"], paths: ["src/waitlist"], entities: [] },
      history: [event(null, "contested"), event("contested", "superseded", "user")]
    }),
    claim({
      id: "CLM-waitlist-notify-only",
      title: "The waitlist only notifies",
      statement: "When a table frees up the waitlist notifies the first customer and never books for them.",
      kind: "intent",
      authority: { kind: "user", source: "fixture" },
      scope: { topics: ["waitlist", "notify"], paths: ["src/waitlist"], entities: [] },
      relationships: [{ type: "supersedes", target: "CLM-waitlist-undecided" }],
      history: [event(null, "proposed"), event("proposed", "accepted", "user")]
    }),
    claim({
      id: "CLM-refund-window",
      title: "The refund window is disputed",
      statement: "Two documents give different refund windows, 7 days and 14 days. Not settled.",
      kind: "conflict",
      state: "contested",
      scope: { topics: ["refund", "window"], paths: [], entities: [] },
      history: [event(null, "contested")]
    }),
    // Proposed by a session: never routed, and counted as needing a ruling.
    claim({
      id: "CLM-export-format",
      title: "Exports should be CSV",
      statement: "Exports are written as CSV files, proposed and not yet accepted.",
      kind: "invariant",
      state: "proposed",
      scope: { topics: ["export"], paths: ["src/export"], entities: [] },
      history: [event(null, "proposed")]
    })
  ];

  const documents = [
    { id: "DOC-readme", path: "README.md", title: "Fixture Shop", kind: "readme", state: "current", authorityRank: 40, stateAsOf: "2026-01-15", topics: ["overview"], replaces: [] },
    { id: "DOC-runbook", path: "docs/runbook.md", title: "Runbook", kind: "runbook", state: "canonical", authorityRank: 70, stateAsOf: "2026-01-15", topics: ["schema", "release"], replaces: [] }
  ];

  // Each scenario leans on one scoring rule, so breaking that rule fails it.
  // None contains a filler word such as "the": that word alone matches most
  // claims and would let every scenario pass with scoring broken.
  const scenarios = [
    // Path only: the prompt shares no word with the claim.
    { id: "SCN-orders-migration", name: "A migration file surfaces the lock hazard by its path", prompt: "add one column", paths: ["db/migrations/0007_notes.sql"], expectedClaims: ["CLM-orders-table-lock"] },
    // Words only: no path is given.
    { id: "SCN-reminder-wording", name: "Rewording a reminder surfaces the send-once rule by its words", prompt: "reword reminder email", paths: [], expectedClaims: ["CLM-reminders-sent-once"] },
    { id: "SCN-waitlist-page", name: "Building a waitlist page surfaces the ruling", prompt: "build waitlist page", paths: ["src/waitlist/page.js"], expectedClaims: ["CLM-waitlist-notify-only"] }
  ];

  write(root, "context/claims.json", stableJson(claims));
  write(root, "context/documents.json", stableJson(documents));
  write(root, "context/scenarios.json", stableJson(scenarios));
  write(root, "context/ledger.config.json", stableJson(fixtureConfig));
  cpSync(join(packageDir, "templates", "schemas"), join(root, "context", "schemas"), { recursive: true });

  let cli = null;
  if (install) {
    const target = join(root, "tools", "context-ledger");
    for (const folder of ["src", "templates", "node_modules"]) cpSync(join(packageDir, folder), join(target, folder), { recursive: true });
    cli = join(target, "src", "cli.mjs");
  }

  return { root, cli };
}
