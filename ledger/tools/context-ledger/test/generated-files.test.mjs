import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { tempDir } from "../fixtures/project.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../src/cli.mjs");
const packageRoot = resolve(here, "..");

// A freshly initialised project, with the package vendored at the depth
// ledger.mjs:8 expects: <root>/tools/context-ledger/src.
function scaffold() {
  const root = tempDir("ledger-generated-");
  cpSync(join(packageRoot, "src"), join(root, "tools", "context-ledger", "src"), { recursive: true });
  cpSync(join(packageRoot, "templates"), join(root, "tools", "context-ledger", "templates"), { recursive: true });
  cpSync(join(packageRoot, "node_modules"), join(root, "tools", "context-ledger", "node_modules"), { recursive: true });
  execFileSync("node", [join(root, "tools", "context-ledger", "src", "cli.mjs"), "init", "--root", root, "--repository", "scratch", "--name", "Scratch"], { encoding: "utf8" });
  return root;
}

test("build-index skips the AGENTS.md view when no template exists", () => {
  const root = scaffold();
  const output = execFileSync("node", [join(root, "tools", "context-ledger", "src", "cli.mjs"), "build-index"], { encoding: "utf8" });
  assert.match(output, /wrote/, "it should write the two context views");
  assert.equal(existsSync(join(root, "AGENTS.md")), false, "no AGENTS.md may be written without a template");
  assert.ok(existsSync(join(root, "context", "generated", "index.json")));
  assert.ok(existsSync(join(root, "context", "generated", "current-state.md")));
});

// `npm run ci` runs the evaluation, so it has to survive the state every
// project starts in: no scenarios yet.
test("the scenario evaluation runs on a freshly initialised project", () => {
  const root = scaffold();
  const output = execFileSync("node", [join(root, "tools", "context-ledger", "src", "evaluate.mjs")], { encoding: "utf8" });
  const report = JSON.parse(output);
  assert.equal(report.scenarios, 0);
  assert.deepEqual(report.correctnessFailures, []);
  assert.equal(report.latency.route.samples, 0);
});

test("build-index --check passes on a freshly built scratch project", () => {
  const root = scaffold();
  const cliPath = join(root, "tools", "context-ledger", "src", "cli.mjs");
  execFileSync("node", [cliPath, "build-index"], { encoding: "utf8" });
  const output = execFileSync("node", [cliPath, "build-index", "--check"], { encoding: "utf8" });
  assert.match(output, /deterministic: 2 files/, "a project without a template has exactly two generated views");
});

test("a project that provides a template does get AGENTS.md generated", () => {
  const root = scaffold();
  const cliPath = join(root, "tools", "context-ledger", "src", "cli.mjs");

  // No template yet: the view is skipped and nothing is written at the root.
  execFileSync("node", [cliPath, "build-index"], { encoding: "utf8" });
  assert.equal(existsSync(join(root, "AGENTS.md")), false);

  // Opting in by adding a template turns the third view on.
  mkdirSync(join(root, "context", "templates"), { recursive: true });
  writeFileSync(join(root, "context", "templates", "AGENTS.md.tmpl"), "# Scratch\n\n{{CONTEXT_BLOCK}}\n", "utf8");
  execFileSync("node", [cliPath, "build-index"], { encoding: "utf8" });

  assert.ok(existsSync(join(root, "AGENTS.md")), "a template opts the project into the AGENTS.md view");
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /GENERATED:CONTEXT-START/);
  assert.match(
    execFileSync("node", [cliPath, "build-index", "--check"], { encoding: "utf8" }),
    /deterministic: 3 files/,
    "with a template the project has three generated views, not two"
  );
});
