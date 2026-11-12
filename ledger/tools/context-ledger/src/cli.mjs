#!/usr/bin/env node
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyReview, checkEvidence, contextRoot, currentClaims, formatPack, gitHead,
  dashboardSnapshot, listNarrativeFiles, loadLedger, normalizePath, repoRoot, routeContext, routingBudget, semanticIssues, stableJson, stableSort, writeIfChanged
} from "./ledger.mjs";
import { loadConfig } from "./config.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argsOf(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) { parsed._.push(value); continue; }
    const key = value.slice(2);
    if (index + 1 < values.length && !values[index + 1].startsWith("--")) parsed[key] = values[++index];
    else parsed[key] = true;
  }
  return parsed;
}

function fail(message, code = 1) { console.error(message); process.exitCode = code; }

function validateLedger(ledger) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = {
    claims: JSON.parse(readFileSync(join(contextRoot, "schemas", "claim.schema.json"), "utf8")),
    documents: JSON.parse(readFileSync(join(contextRoot, "schemas", "document.schema.json"), "utf8")),
    scenarios: JSON.parse(readFileSync(join(contextRoot, "schemas", "scenario.schema.json"), "utf8"))
  };
  const errors = [];
  for (const [kind, records] of Object.entries(ledger)) {
    const validate = ajv.compile(schemas[kind]);
    records.forEach((record, index) => { if (!validate(record)) errors.push(...validate.errors.map(error => `${kind}[${index}]${error.instancePath} ${error.message}`)); });
  }
  errors.push(...semanticIssues(ledger).filter(issue => issue.level === "error").map(issue => `${issue.code}: ${issue.message}`));
  return errors;
}

function generatedFiles(ledger) {
  const current = currentClaims(ledger);
  const index = {
    schemaVersion: 1,
    generatedFrom: ["context/claims.json", "context/documents.json", "context/scenarios.json"],
    claims: current.map(claim => ({ id: claim.id, kind: claim.kind, state: claim.state, topics: claim.scope.topics, paths: claim.scope.paths, entities: claim.scope.entities, relationships: claim.relationships }))
  };
  const stateLines = ["# Current context state", "", "Generated. Do not edit by hand.", ""];
  for (const claim of current) stateLines.push(`- **${claim.id}** (${claim.state}, ${claim.authority.kind}): ${claim.statement}`);

  const files = new Map([
    [join(contextRoot, "generated", "index.json"), stableJson(index)],
    [join(contextRoot, "generated", "current-state.md"), `${stateLines.join("\n")}\n`]
  ]);

  // The AGENTS.md view is opt-in: a project receives it only by providing a
  // template. Without this guard build-index throws in a freshly initialised
  // project, and where a template did exist it would silently overwrite a
  // hand-written AGENTS.md at the repository root.
  const templatePath = join(contextRoot, "templates", "AGENTS.md.tmpl");
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, "utf8");
    const universal = current.filter(claim => claim.universal && claim.kind !== "conflict" && claim.state !== "contested");
    const conflicts = current.filter(claim => claim.universal && (claim.kind === "conflict" || claim.state === "contested") && ["critical", "high"].includes(claim.severity));
    const block = ["<!-- GENERATED:CONTEXT-START -->", ...universal.map(claim => `- [${claim.id}] ${claim.statement}`)];
    if (conflicts.length) block.push("", "Critical conflicts:", ...conflicts.map(claim => `- [${claim.id}] ${claim.statement}`));
    block.push("<!-- GENERATED:CONTEXT-END -->");
    const agents = template.replace("{{CONTEXT_BLOCK}}", block.join("\n"));
    files.set(join(repoRoot, "AGENTS.md"), agents.endsWith("\n") ? agents : `${agents}\n`);
  }

  return files;
}

function reviewPacket(ledger) {
  const groups = [
    ["Mechanically verified implementation facts", claim => ["fact", "hazard"].includes(claim.kind) && ["verified", "enforced"].includes(claim.state)],
    ["Proposed architectural interpretations", claim => claim.state === "proposed" && claim.kind === "invariant"],
    ["Product decisions requiring user authority", claim => claim.state === "proposed" && claim.authority.kind === "session"],
    ["Conflicts requiring resolution", claim => claim.state === "contested" || (claim.kind === "conflict" && claim.state !== "superseded")],
    ["Supersession proposals", claim => claim.state === "superseded"]
  ];
  const lines = [`# ${loadConfig().displayName} context review packet`, "", `Generated from commit ${gitHead()}.`];
  for (const [title, predicate] of groups) {
    const claims = stableSort(ledger.claims.filter(predicate), claim => claim.id);
    if (!claims.length) continue;
    lines.push(`\n## ${title}`);
    for (const claim of claims) lines.push(`\n- **${claim.id}** (${claim.state}): ${claim.statement}\n  - Authority: ${claim.authority.kind} via ${claim.authority.source}\n  - Evidence: ${claim.evidence.map(item => `${item.path} (${item.locator.kind}: ${item.locator.value})`).join("; ") || "none"}`);
  }
  lines.push("\nReply with explicit claim IDs and decisions. Silence leaves proposed claims proposed.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const args = argsOf(rest);
  if (command === "init") {
    for (const flag of ["root", "repository", "name"]) {
      if (flag in args && typeof args[flag] !== "string") {
        fail(`--${flag} needs a value.`);
        return;
      }
    }
    const target = resolve(args.root ?? repoRoot);
    const contextDir = join(target, "context");
    if (existsSync(contextDir)) {
      fail(`A context directory already exists at ${contextDir}. Refusing to overwrite it.`);
      return;
    }
    const repository = String(args.repository ?? basename(target)).toLowerCase();
    const displayName = String(args.name ?? basename(target));

    mkdirSync(join(contextDir, "schemas"), { recursive: true });
    mkdirSync(join(contextDir, "generated"), { recursive: true });
    cpSync(join(packageDir, "templates", "schemas"), join(contextDir, "schemas"), { recursive: true });

    for (const file of ["claims.json", "documents.json", "scenarios.json"]) {
      writeFileSync(join(contextDir, file), stableJson([]), "utf8");
    }
    writeFileSync(join(contextDir, "ledger.config.json"), stableJson({ repository, displayName }), "utf8");

    process.stdout.write(`Initialised ${displayName} ledger at ${contextDir}\n`);
    return;
  }
  let ledger;
  try { ledger = loadLedger(); } catch (error) { fail(`ledger unavailable: ${error.message}`); return; }
  if (command === "validate") {
    const errors = validateLedger(ledger);
    const warnings = semanticIssues(ledger).filter(issue => issue.level === "warning");
    warnings.forEach(issue => console.warn(`warning ${issue.code}: ${issue.message}`));
    if (errors.length) { errors.forEach(error => fail(error)); return; }
    console.log(`valid: ${ledger.claims.length} claims, ${ledger.documents.length} documents, ${ledger.scenarios.length} scenarios`);
  } else if (command === "route") {
    const pack = routeContext(ledger, { prompt: args.prompt ?? "", paths: String(args.paths ?? "").split(",").filter(Boolean), limit: Number(args.limit ?? routingBudget), ignore: loadConfig().ignoreWords });
    // The hook sends nothing when nothing routed. Here that would look like a
    // broken command, so say it.
    process.stdout.write(args.format === "markdown" ? (formatPack(pack) || `# ${loadConfig().displayName} routed context\n\nNo claim routed for this prompt.\n`) : stableJson(pack));
  } else if (command === "expand") {
    const id = args.claim;
    if (id) {
      const claim = ledger.claims.find(item => item.id === id);
      if (!claim) return fail(`unknown claim: ${id}`);
      process.stdout.write(stableJson(claim));
    } else if (args.topic) {
      const claims = ledger.claims.filter(claim => claim.scope.topics.includes(args.topic));
      process.stdout.write(stableJson(stableSort(claims, claim => claim.id)));
    } else fail("expand requires --claim or --topic");
  } else if (command === "audit-documents") {
    const registered = new Set(ledger.documents.map(document => document.path.toLowerCase()));
    const actual = listNarrativeFiles();
    const missing = actual.filter(path => !registered.has(path.toLowerCase()));
    const absent = ledger.documents.filter(document => !existsSync(join(repoRoot, document.path))).map(document => document.path);
    const now = new Date().toISOString().slice(0, 10);
    const expired = ledger.documents.filter(document => document.state === "current" && document.reviewBy && document.reviewBy < now);
    missing.forEach(path => fail(`unregistered document: ${path}`));
    absent.forEach(path => fail(`registered document missing: ${path}`));
    expired.forEach(document => console.warn(`warning expired current document: ${document.id} reviewBy=${document.reviewBy}`));
    if (!missing.length && !absent.length) console.log(`document registry covers ${actual.length} narrative files`);
  } else if (command === "review-packet") {
    if (args.apply) {
      const input = JSON.parse(readFileSync(args.apply, "utf8"));
      applyReview(ledger, input.decisions ?? input);
      console.log(`applied ${input.decisions?.length ?? input.length} review decisions`);
    } else process.stdout.write(reviewPacket(ledger));
  } else if (command === "check-stale") {
    let changedPaths = null;
    if (args.base) {
      try {
        changedPaths = new Set(execFileSync("git", ["-c", `safe.directory=${normalizePath(repoRoot)}`, "-C", repoRoot, "diff", "--name-only", String(args.base), "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).filter(Boolean).map(normalizePath));
      } catch {
        console.warn(`warning could not resolve base commit: ${args.base}; anchor checks still ran`);
      }
    }
    const verifyAll = Boolean(args.verify);
    const checked = checkEvidence(ledger, { runVerification: verifyAll || Boolean(changedPaths?.size), verificationPaths: verifyAll ? null : changedPaths });
    let failures = 0;
    for (const result of checked.results.filter(item => !item.ok)) {
      const blocking = ["accepted", "verified", "enforced"].includes(result.state);
      const message = `${blocking ? "error" : "warning"} stale ${result.claimId}: ${result.path}: ${result.reason}`;
      if (blocking) { failures += 1; console.error(message); } else console.warn(message);
    }
    for (const result of checked.verification.filter(item => !item.ok)) { failures += 1; console.error(`error verification failed (${result.claimIds.join(", ")}): ${result.command}\n${result.output}`); }
    if (args.base && changedPaths) console.log(`base considered: ${args.base}; ${changedPaths.size} changed paths`);
    if (!failures) console.log(`evidence current: ${checked.results.length} anchors; ${checked.verification.length} verification commands run`);
    else process.exitCode = 1;
  } else if (command === "dashboard") {
    const errors = validateLedger(ledger);
    if (errors.length) { errors.forEach(error => fail(error)); return; }
    process.stdout.write(stableJson(dashboardSnapshot(ledger)));
  } else if (command === "build-index") {
    const files = generatedFiles(ledger);
    let differences = 0;
    for (const [path, content] of files) {
      if (args.check) {
        if (!existsSync(path) || readFileSync(path, "utf8") !== content) { console.error(`generated output differs: ${path}`); differences += 1; }
      } else if (writeIfChanged(path, content)) console.log(`wrote ${path}`);
    }
    if (differences) process.exitCode = 1;
    else if (args.check) console.log(`generated output deterministic: ${files.size} files`);
  } else {
    console.log("Commands: init, validate, route, expand, audit-documents, review-packet, check-stale, dashboard, build-index");
  }
}

main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
