import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig, packageRoot } from "../src/config.mjs";
import { tempDir } from "../fixtures/project.mjs";

function scratch(contents) {
  const root = tempDir("ledger-config-");
  mkdirSync(join(root, "context"), { recursive: true });
  if (contents !== null) writeFileSync(join(root, "context", "ledger.config.json"), contents, "utf8");
  return root;
}

test("reads repository and displayName from the config file", () => {
  const root = scratch(JSON.stringify({ repository: "tablebook", displayName: "Tablebook" }));
  assert.deepEqual(loadConfig(root), { repository: "tablebook", displayName: "Tablebook" });
});

test("falls back to the directory name when no config exists", () => {
  const root = scratch(null);
  const config = loadConfig(root);
  assert.equal(config.repository, basename(root).toLowerCase());
  assert.equal(config.displayName, basename(root));
});

test("falls back rather than throwing on malformed JSON", () => {
  const root = scratch("{ not json");
  const config = loadConfig(root);
  assert.equal(config.repository, basename(root).toLowerCase());
});

test("falls back per field when a field is missing or empty", () => {
  const root = scratch(JSON.stringify({ repository: "", displayName: "Kept" }));
  const config = loadConfig(root);
  assert.equal(config.repository, basename(root).toLowerCase());
  assert.equal(config.displayName, "Kept");
});

// The package lives at <project>/tools/context-ledger, so the project is three
// folders above src/. Asserted as a location, never as a project name: a name
// here passes in one project and fails in every other one the package is
// copied into.
test("the zero-argument form resolves the project this package is installed in", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  assert.equal(packageRoot, resolve(here, "..", "..", ".."));
  assert.deepEqual(loadConfig(), loadConfig(packageRoot));
});
