import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { stableJson } from "../src/ledger.mjs";
import { fixtureConfig, makeProject, tempDir } from "../fixtures/project.mjs";

// The CLI finds its project from its own location, so these run a copy of the
// package installed inside the fixture project. This is also what proves the
// fixture passes the JSON schemas: the other test files only load it.
const project = makeProject({ install: true });
const run = (...args) => execFileSync(process.execPath, [project.cli, ...args], { encoding: "utf8" });

test("validate accepts the populated fixture ledger", () => {
  assert.match(run("validate"), /valid: 9 claims, 2 documents, 3 scenarios/);
});

test("route prints a pack under the configured project name", () => {
  const output = run("route", "--prompt", "build waitlist page", "--paths", "src/waitlist/page.js", "--format", "markdown");
  assert.match(output, new RegExp(`^# ${fixtureConfig.displayName} routed context`));
  assert.match(output, /CLM-waitlist-notify-only/);
  assert.match(output, /CLM-copy-language/, "the universal claim rides along");
  assert.doesNotMatch(output, /CLM-waitlist-undecided/, "the superseded side stays out");
});

test("expand returns one whole claim by id", () => {
  const claim = JSON.parse(run("expand", "--claim", "CLM-orders-table-lock"));
  assert.equal(claim.id, "CLM-orders-table-lock");
  assert.equal(claim.evidence.length, 1);
});

test("a claim may carry a detail: validate accepts it, expand prints it, an empty one is an error", () => {
  const own = makeProject({ install: true });
  const path = join(own.root, "context", "claims.json");
  const cli = (...args) => spawnSync(process.execPath, [own.cli, ...args], { encoding: "utf8" });
  const write = detail => {
    const claims = JSON.parse(readFileSync(path, "utf8"));
    claims.find(claim => claim.id === "CLM-orders-table-lock").detail = detail;
    writeFileSync(path, JSON.stringify(claims, null, 2), "utf8");
  };
  write("Seen on 2026-03-02: the site hung for four minutes behind one ALTER.");
  const valid = cli("validate");
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.equal(JSON.parse(cli("expand", "--claim", "CLM-orders-table-lock").stdout).detail, "Seen on 2026-03-02: the site hung for four minutes behind one ALTER.");
  const routed = cli("route", "--prompt", "alter the orders table", "--format", "markdown").stdout;
  assert.match(routed, /Set a lock timeout and retry\. \[\+detail\]/);
  assert.equal(routed.includes("four minutes"), false);
  write("");
  assert.notEqual(cli("validate").status, 0, "an empty detail is a mistake, not a claim without one");
  write("   ");
  assert.notEqual(cli("validate").status, 0, "and so is one that holds only spaces");
  assert.equal(cli("route", "--prompt", "alter the orders table", "--format", "markdown").stdout.includes("[+detail]"), false, "which is not marked as something to go and read");
});

test("audit-documents finds every narrative file registered", () => {
  assert.match(run("audit-documents"), /document registry covers 2 narrative files/);
});

test("check-stale passes when the only stale anchor belongs to a superseded claim", () => {
  assert.match(run("check-stale"), /evidence current: 3 anchors; 0 verification commands run/);
});

test("check-stale --verify runs the declared verification command", () => {
  assert.match(run("check-stale", "--verify"), /evidence current: 3 anchors; 1 verification commands run/);
});

test("dashboard prints a snapshot for the configured repository", () => {
  const snapshot = JSON.parse(run("dashboard"));
  assert.equal(snapshot.source.repository, fixtureConfig.repository);
  assert.equal(snapshot.claims.length, 9);
});

// One error, not several, is the case that matters: the exit code used to be
// the error's position in the list, so a ledger with a single error exited 0
// and passed `npm run ci`.
test("validate and dashboard exit non-zero when the ledger has exactly one error", () => {
  const broken = makeProject({ install: true });
  const path = join(broken.root, "context", "claims.json");
  const claims = JSON.parse(readFileSync(path, "utf8"));
  claims.find(claim => claim.id === "CLM-refund-window").state = "accepted";
  writeFileSync(path, stableJson(claims), "utf8");
  for (const command of ["validate", "dashboard"]) {
    const result = spawnSync(process.execPath, [broken.cli, command], { encoding: "utf8" });
    assert.match(result.stderr, /history-state: CLM-refund-window/);
    assert.equal(result.stderr.trim().split("\n").length, 1, "the fixture must produce one error, or this proves nothing");
    assert.equal(result.status, 1, `${command} must fail on a single error`);
  }
});

// Windows PowerShell puts a byte-order mark in front of piped text. Without
// this the hook, which fails silent by design, prints nothing when someone
// tries it by hand from that shell, and looks broken.
test("the hook accepts input that starts with a byte-order mark", () => {
  const session = `bom-probe-${randomUUID()}`;
  // The real spelling of the path, so the hook's "was I run directly" check
  // compares like with like on machines whose temp folder has a short name.
  const hook = realpathSync.native(join(dirname(project.cli), "hook.mjs"));
  const input = `﻿${JSON.stringify({ session_id: session, prompt: "build the waitlist page" })}`;
  const result = spawnSync(process.execPath, [hook, "UserPromptSubmit"], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project.root } });
  assert.match(result.stdout, /CLM-waitlist-notify-only/);
  rmSync(join(tmpdir(), "context-ledger", fixtureConfig.repository, `${session}.json`), { force: true });
});

// The session's folder reaches the hook through the environment Claude Code
// gives it, or through `cwd` in its input. Both are read only by the code
// that runs when the hook is started as a program.
test("the hook, started as a program, learns the session's project from its environment or its input", () => {
  const own = makeProject({ install: true });
  writeFileSync(join(own.root, "context", "ledger.config.json"), JSON.stringify({ ...fixtureConfig, appliesTo: ["*.uproject"] }), "utf8");
  const hook = realpathSync.native(join(dirname(own.cli), "hook.mjs"));
  // An empty folder of its own. The temp folder itself would not do: the
  // hook also looks one level under the session's folder, and other tests
  // put folders with a matching file there while this one runs.
  const elsewhere = realpathSync.native(tempDir("ledger-elsewhere-"));
  const { CLAUDE_PROJECT_DIR: inherited, ...bare } = process.env;
  const ask = (env, extra = {}) => {
    const session = `guest-probe-${randomUUID()}`;
    const result = spawnSync(process.execPath, [hook, "UserPromptSubmit"], { input: JSON.stringify({ session_id: session, prompt: "build the waitlist page", ...extra }), encoding: "utf8", env });
    rmSync(join(tmpdir(), "context-ledger", fixtureConfig.repository, `${session}.json`), { force: true });
    return result.stdout;
  };
  assert.match(ask({ ...bare, CLAUDE_PROJECT_DIR: own.root }), /CLM-waitlist-notify-only/, "a session in the ledger's own project");
  assert.equal(ask({ ...bare, CLAUDE_PROJECT_DIR: elsewhere }), "", "a session in a project the ledger does not apply to");
  assert.equal(ask(bare, { cwd: elsewhere }), "", "the same, known only from the input");
  assert.match(ask(bare), /CLM-waitlist-notify-only/, "and with neither, the ledger's own project is assumed");
});

test("generated views are deterministic for a populated ledger", () => {
  assert.match(run("build-index"), /wrote/);
  assert.match(run("build-index", "--check"), /generated output deterministic: 2 files/);
});
