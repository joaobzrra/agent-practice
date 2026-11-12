import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildHookOutput } from "../src/hook.mjs";
import { fixtureConfig, makeProject } from "../fixtures/project.mjs";

const project = makeProject();

// The session id must be unique per run. buildHookOutput deduplicates by
// SHA-256 of the rendered context, keyed per session, and persists that state
// to the real tmpdir. A fixed id makes the second run of this file fail: the
// hook correctly returns null because it already injected identical content.
// stateRoot is deliberately left at its default — the default IS what this
// test exists to check, so passing an isolated one would test nothing.
test("hook state is written under a repository-specific directory", () => {
  const session = `hook-state-probe-${randomUUID()}`;
  const output = buildHookOutput("SessionStart", { session_id: session }, { root: project.root });
  assert.ok(output, "SessionStart should produce context for a populated ledger");
  const statePath = join(tmpdir(), "context-ledger", fixtureConfig.repository, `${session}.json`);
  assert.ok(existsSync(statePath), "state file should sit in a directory named after the repository");
  rmSync(statePath);
});

test("hook returns null for an unknown event rather than throwing", () => {
  assert.equal(buildHookOutput("NotAnEvent", { session_id: `hook-state-probe-${randomUUID()}` }, { root: project.root }), null);
});
