import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { tempDir } from "../fixtures/project.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../src/cli.mjs");
const packageRoot = resolve(here, "..");

function runInit(root, repository, name) {
  return execFileSync("node", [cli, "init", "--root", root, "--repository", repository, "--name", name], { encoding: "utf8" });
}

test("init scaffolds a complete context directory", () => {
  const root = tempDir("ledger-init-");
  runInit(root, "tablebook", "Tablebook");

  for (const file of ["claims.json", "documents.json", "scenarios.json", "ledger.config.json"]) {
    assert.ok(existsSync(join(root, "context", file)), `${file} should exist`);
  }
  for (const schema of ["claim.schema.json", "document.schema.json", "scenario.schema.json"]) {
    assert.ok(existsSync(join(root, "context", "schemas", schema)), `${schema} should exist`);
  }

  assert.deepEqual(JSON.parse(readFileSync(join(root, "context", "claims.json"), "utf8")), []);
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, "context", "ledger.config.json"), "utf8")),
    { repository: "tablebook", displayName: "Tablebook" }
  );
});

test("init refuses to overwrite an existing ledger", () => {
  const root = tempDir("ledger-init-twice-");
  runInit(root, "one", "One");
  assert.throws(() => runInit(root, "two", "Two"), /already exists/i);
  assert.equal(
    JSON.parse(readFileSync(join(root, "context", "ledger.config.json"), "utf8")).repository,
    "one",
    "the first config must survive"
  );
});

test("init rejects a flag given no value", () => {
  const root = tempDir("ledger-init-flag-");
  assert.throws(
    () => execFileSync("node", [cli, "init", "--root", root, "--repository", "--name", "X"], { encoding: "utf8" }),
    /needs a value/
  );
  assert.equal(existsSync(join(root, "context")), false, "nothing may be scaffolded when a flag is malformed");
});

// Compares against the project this package is installed in, so it is skipped
// where that project has no ledger yet (a fresh copy, before `init`). After a
// package update it fails until the project's schemas are refreshed from
// templates/schemas, which is the point. Content is compared, not bytes: git
// may check the two folders out with different line endings.
const content = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const hostSchemas = join(packageRoot, "..", "..", "context", "schemas");

test("templates have not drifted from the host project's schemas", { skip: !existsSync(hostSchemas) && "host project has no context/schemas" }, () => {
  for (const schema of ["claim.schema.json", "document.schema.json", "scenario.schema.json"]) {
    assert.equal(
      content(join(packageRoot, "templates", "schemas", schema)),
      content(join(hostSchemas, schema)),
      `${schema} template must match the project schema`
    );
  }
});
