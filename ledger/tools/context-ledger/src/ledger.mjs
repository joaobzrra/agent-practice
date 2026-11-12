import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");
export const contextRoot = join(repoRoot, "context");

export const activeStates = new Set(["accepted", "verified", "enforced", "contested"]);
export const lifecycle = new Map([
  ["proposed", new Set(["accepted", "verified", "contested", "superseded"])],
  ["accepted", new Set(["verified", "enforced", "contested", "superseded"])],
  ["verified", new Set(["enforced", "contested", "superseded"])],
  ["enforced", new Set(["contested", "superseded"])],
  ["contested", new Set(["proposed", "accepted", "verified", "enforced", "superseded"])],
  ["superseded", new Set()]
]);

export function stableSort(values, selector = value => value) {
  return [...values].sort((a, b) => {
    const left = String(selector(a));
    const right = String(selector(b));
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export function stableJson(value) {
  const normalize = item => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(stableSort(Object.entries(item), pair => pair[0]).map(([key, val]) => [key, normalize(val)]));
    }
    return item;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function normalizeContent(value) {
  return value.replace(/\r\n?/g, "\n").split("\n").map(line => line.trimEnd()).join("\n").trim().replace(/[ \t]+/g, " ");
}

export function contentHash(value) {
  return `sha256:${createHash("sha256").update(normalizeContent(value), "utf8").digest("hex")}`;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadLedger(root = repoRoot) {
  const folder = join(root, "context");
  return {
    claims: readJson(join(folder, "claims.json")),
    documents: readJson(join(folder, "documents.json")),
    scenarios: readJson(join(folder, "scenarios.json"))
  };
}

function lineOf(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function markdownHeading(text, heading) {
  const lines = text.split(/\r?\n/);
  const wanted = heading.trim().replace(/^#+\s*/, "").toLowerCase();
  const start = lines.findIndex(line => /^#{1,6}\s+/.test(line) && line.replace(/^#{1,6}\s+/, "").trim().toLowerCase() === wanted);
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#+)\s+/);
    if (match && match[1].length <= level) { end = index; break; }
  }
  return { content: lines.slice(start, end).join("\n"), line: start + 1 };
}

function csharpSymbol(text, symbol) {
  const short = symbol.split(".").at(-1);
  const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:class|record|struct|interface|enum)\\s+${escaped}\\b`),
    new RegExp(`\\b${escaped}\\s*(?:<[^>]+>)?\\s*\\(`),
    new RegExp(`\\b${escaped}\\s*(?:=>|\\{)`)
  ];
  let match;
  for (const pattern of patterns) { match = pattern.exec(text); if (match) break; }
  if (!match) return null;
  const declarationStart = text.lastIndexOf("\n", match.index) + 1;
  const brace = text.indexOf("{", match.index);
  const arrow = text.indexOf("=>", match.index);
  const semicolon = text.indexOf(";", match.index);
  let end;
  if (arrow >= 0 && (brace < 0 || arrow < brace) && (semicolon < 0 || arrow < semicolon)) {
    end = semicolon + 1;
  } else if (brace >= 0) {
    let depth = 0;
    let inString = false;
    let escapedChar = false;
    for (let index = brace; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escapedChar) escapedChar = false;
        else if (char === "\\") escapedChar = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) { end = index + 1; break; }
    }
  }
  if (!end || end <= declarationStart) return null;
  return { content: text.slice(declarationStart, end), line: lineOf(text, declarationStart) };
}

function structuredPath(text, pathValue) {
  let current = JSON.parse(text);
  const parts = pathValue.replace(/^\$\.?/, "").split(".").filter(Boolean);
  for (const part of parts) {
    if (current === null || !(part in current)) return null;
    current = current[part];
  }
  return { content: stableJson(current), line: 1 };
}

function yamlPath(text, pathValue) {
  const lines = text.split(/\r?\n/);
  const parts = pathValue.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let start = 0;
  let end = lines.length;
  let parentIndent = -1;
  let located = null;
  for (const part of parts) {
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keyPattern = new RegExp(`^\\s*${escaped}\\s*:`);
    let index = -1;
    for (let cursor = start; cursor < end; cursor += 1) {
      const indent = lines[cursor].match(/^\s*/)[0].length;
      if (indent > parentIndent && keyPattern.test(lines[cursor])) { index = cursor; break; }
    }
    if (index < 0) return null;
    const indent = lines[index].match(/^\s*/)[0].length;
    let blockEnd = end;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (!lines[cursor].trim() || lines[cursor].trimStart().startsWith("#")) continue;
      if (lines[cursor].match(/^\s*/)[0].length <= indent) { blockEnd = cursor; break; }
    }
    located = { content: lines.slice(index, blockEnd).join("\n"), line: index + 1 };
    start = index + 1;
    end = blockEnd;
    parentIndent = indent;
  }
  return located;
}

export function resolveAnchor(anchor, root = repoRoot) {
  const absolute = resolve(root, anchor.path);
  if (!absolute.startsWith(resolve(root) + sep) && absolute !== resolve(root)) return { ok: false, reason: "path escapes repository" };
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return { ok: false, reason: "path missing" };
  const text = readFileSync(absolute, "utf8");
  let located;
  switch (anchor.locator.kind) {
    case "file": located = { content: text, line: 1 }; break;
    case "heading": located = markdownHeading(text, anchor.locator.value); break;
    case "symbol": located = csharpSymbol(text, anchor.locator.value); break;
    case "jsonPath": located = structuredPath(text, anchor.locator.value); break;
    case "yamlPath": located = yamlPath(text, anchor.locator.value); break;
    case "excerpt": {
      const index = normalizeContent(text).indexOf(normalizeContent(anchor.locator.value));
      located = index < 0 ? null : { content: anchor.locator.value, line: lineOf(text, text.indexOf(anchor.locator.value)) };
      break;
    }
    default: located = null;
  }
  if (!located) return { ok: false, reason: `${anchor.locator.kind} locator missing` };
  const actualHash = contentHash(located.content);
  return { ok: actualHash === anchor.normalizedContentHash, stale: actualHash !== anchor.normalizedContentHash, actualHash, line: located.line, content: located.content, reason: actualHash === anchor.normalizedContentHash ? undefined : "content changed" };
}

export function semanticIssues(ledger) {
  const issues = [];
  const claimIds = new Set();
  for (const claim of ledger.claims) {
    if (claimIds.has(claim.id)) issues.push({ level: "error", code: "duplicate-claim", message: claim.id });
    claimIds.add(claim.id);
    let previous = null;
    for (const event of claim.history) {
      if (event.from !== previous) issues.push({ level: "error", code: "history-chain", message: `${claim.id}: expected from ${previous}, got ${event.from}` });
      if (previous !== null && !lifecycle.get(previous)?.has(event.to)) issues.push({ level: "error", code: "lifecycle", message: `${claim.id}: ${previous} -> ${event.to}` });
      previous = event.to;
    }
    if (previous !== claim.state) issues.push({ level: "error", code: "history-state", message: `${claim.id}: history ends ${previous}, record says ${claim.state}` });
  }
  for (const claim of ledger.claims) {
    for (const relationship of claim.relationships) {
      if (!claimIds.has(relationship.target)) issues.push({ level: "error", code: "broken-reference", message: `${claim.id} -> ${relationship.target}` });
    }
  }
  const documentIds = new Set();
  const documentPaths = new Set();
  for (const document of ledger.documents) {
    if (documentIds.has(document.id)) issues.push({ level: "error", code: "duplicate-document", message: document.id });
    if (documentPaths.has(normalizePath(document.path).toLowerCase())) issues.push({ level: "error", code: "duplicate-document-path", message: document.path });
    documentIds.add(document.id);
    documentPaths.add(normalizePath(document.path).toLowerCase());
  }
  for (const document of ledger.documents) for (const target of document.replaces) if (!documentIds.has(target)) issues.push({ level: "error", code: "broken-document-reference", message: `${document.id} -> ${target}` });
  const scenarioIds = new Set();
  for (const scenario of ledger.scenarios) {
    if (scenarioIds.has(scenario.id)) issues.push({ level: "error", code: "duplicate-scenario", message: scenario.id });
    scenarioIds.add(scenario.id);
    for (const id of scenario.expectedClaims) if (!claimIds.has(id)) issues.push({ level: "error", code: "broken-scenario-reference", message: `${scenario.id} -> ${id}` });
  }
  const singleValues = new Map();
  for (const claim of ledger.claims.filter(item => activeStates.has(item.state) && item.singleValueKey)) {
    const existing = singleValues.get(claim.singleValueKey) ?? [];
    existing.push(claim);
    singleValues.set(claim.singleValueKey, existing);
  }
  for (const [key, claims] of singleValues) {
    if (claims.length > 1 && claims.some(claim => claim.state === "enforced") && !claims.every(claim => claim.state === "contested")) {
      issues.push({ level: "error", code: "single-value-conflict", message: `${key}: ${claims.map(claim => claim.id).join(", ")}` });
    } else if (claims.length > 1) {
      issues.push({ level: "warning", code: "semantic-conflict", message: `${key}: ${claims.map(claim => claim.id).join(", ")}` });
    }
  }
  // "Universal means always injected" is only true while the always-inject
  // closure — universal claims plus the conflict components they belong to —
  // fits the smallest hook routing budget. Past that, routing must drop
  // something mandatory, so the ledger fails validation here instead of
  // failing silently on every prompt.
  const active = ledger.claims.filter(claim => activeStates.has(claim.state));
  const mandatory = conflictComponents(active).filter(members => members.some(member => member.universal)).flat();
  if (mandatory.length > routingBudget) {
    issues.push({ level: "error", code: "universal-overflow", message: `${mandatory.length} always-inject claims exceed the routing budget of ${routingBudget}; demote some universal flags or raise the budget deliberately` });
  }
  return issues;
}

function tokens(value) {
  return new Set(value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/[^a-z0-9_.\/-]+/).filter(token => token.length > 2));
}

// The smallest claim budget any hook event routes with. Validation checks the
// always-inject closure against this number, so a ledger that can no longer
// honour "universal means always injected" fails `validate` instead of
// silently dropping a rule at runtime.
//
// 24 is chosen, not inherited: the largest ledger this ran on had an
// always-inject closure of 22 when the number was set, and a budget at or
// below the closure drops a mandatory claim by arithmetic alone. The
// cost is the ceiling, since every UserPromptSubmit pays it — 24 claims render
// to roughly 1.9k tokens. The headroom is deliberately two, so the next pair of
// universal flags is admitted and the pair after that trips validation instead
// of quietly buying prompt weight. Raising this again is a real decision about
// per-prompt cost, not a formality: prefer scoping a claim's paths over
// widening the budget.
export const routingBudget = 24;

export const severityRank = new Map([["critical", 3], ["high", 2], ["medium", 1], ["low", 0]]);

function scoreClaim(claim, promptTokens, pathValues) {
  let score = 0;
  const fields = [...claim.scope.topics, ...claim.scope.entities, claim.title, claim.statement];
  for (const token of tokens(fields.join(" "))) if (promptTokens.has(token)) score += 2;
  for (const claimPath of claim.scope.paths.map(normalizePath)) {
    for (const inputPath of pathValues) if (inputPath.startsWith(claimPath) || claimPath.startsWith(inputPath)) score += 12;
  }
  if (claim.state === "contested") score += 3;
  return score;
}

// conflictsWith is undirected for routing: a session must never see only one
// side of a known contradiction, whichever side declared the edge. Chains
// (A conflicts B, B conflicts C) merge into one component, because admitting
// B without C would again show one side of a contradiction.
export function conflictComponents(claims) {
  const byId = new Map(claims.map(claim => [claim.id, claim]));
  const neighbours = new Map(claims.map(claim => [claim.id, new Set()]));
  for (const claim of claims) {
    for (const relationship of claim.relationships.filter(item => item.type === "conflictsWith")) {
      if (!byId.has(relationship.target)) continue;
      neighbours.get(claim.id).add(relationship.target);
      neighbours.get(relationship.target).add(claim.id);
    }
  }
  const components = [];
  const assigned = new Set();
  for (const claim of claims) {
    if (assigned.has(claim.id)) continue;
    assigned.add(claim.id);
    const members = [];
    const queue = [claim.id];
    while (queue.length) {
      const id = queue.pop();
      members.push(byId.get(id));
      for (const next of neighbours.get(id)) if (!assigned.has(next)) { assigned.add(next); queue.push(next); }
    }
    components.push(stableSort(members, member => member.id));
  }
  return components;
}

export function routeContext(ledger, { prompt = "", paths = [], limit = 24 } = {}) {
  const promptTokens = tokens(prompt);
  const normalizedPaths = paths.map(normalizePath);
  const eligible = ledger.claims.filter(claim => activeStates.has(claim.state));
  const scores = new Map(eligible.map(claim => [claim.id, scoreClaim(claim, promptTokens, normalizedPaths)]));
  const components = conflictComponents(eligible).map(members => ({
    members,
    mandatory: members.some(member => member.universal),
    severity: Math.max(...members.map(member => severityRank.get(member.severity) ?? 0)),
    score: Math.max(...members.map(member => scores.get(member.id)))
  }));
  // A component routes when a member is universal (always inject) or a member
  // matched the prompt/paths. It is admitted or skipped whole: a partial
  // conflict component would break the never-one-side promise, so a pair that
  // no longer fits under the cap is skipped entirely and a smaller component
  // may take the remaining room instead.
  const candidates = components.filter(component => component.mandatory || component.score > 0);
  candidates.sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    // Universal claims are injected for what they protect, not for prompt
    // relevance, so under an overflowing budget severity decides which of
    // them survive; scoped claims are retrieved by relevance, so score does.
    const keys = a.mandatory
      ? [b.severity - a.severity, b.score - a.score]
      : [b.score - a.score, b.severity - a.severity];
    for (const key of keys) if (key !== 0) return key;
    return a.members[0].id < b.members[0].id ? -1 : 1;
  });
  const selected = [];
  // A mandatory component that cannot fit is still skipped whole — but never
  // silently: the pack names what was dropped, so a caller-supplied limit
  // below the always-inject closure stays visible instead of quietly eating
  // a rule marked universal. The whole component is reported, non-universal
  // counterparts included, because none of it routed.
  const droppedMandatory = [];
  for (const component of candidates) {
    if (selected.length + component.members.length > limit) {
      if (component.mandatory) droppedMandatory.push(...component.members.map(member => member.id));
      continue;
    }
    selected.push(...component.members);
  }
  const classify = claim => claim.state === "contested" || claim.kind === "conflict" ? "openConflicts"
    : claim.kind === "invariant" ? "bindingInvariants"
      : claim.kind === "intent" ? "acceptedIntent"
        : "currentVerifiedFacts";
  const output = { bindingInvariants: [], currentVerifiedFacts: [], acceptedIntent: [], openConflicts: [], requiredEvidence: [], verificationCommands: [], expansionHandles: [], droppedMandatory: stableSort([...new Set(droppedMandatory)]) };
  for (const claim of selected) {
    const compact = { id: claim.id, statement: claim.statement, state: claim.state, authority: claim.authority, provenance: claim.evidence.map(item => ({ path: item.path, locator: item.locator, verifiedAtCommit: item.verifiedAtCommit })) };
    output[classify(claim)].push(compact);
    output.expansionHandles.push(claim.id);
    for (const evidence of claim.evidence) {
      output.requiredEvidence.push({ claimId: claim.id, path: evidence.path, locator: evidence.locator });
      if (evidence.verification.command) output.verificationCommands.push(evidence.verification.command);
    }
  }
  for (const key of ["bindingInvariants", "currentVerifiedFacts", "acceptedIntent", "openConflicts"]) output[key] = stableSort(output[key], item => item.id);
  output.requiredEvidence = stableSort(uniqueObjects(output.requiredEvidence), item => `${item.claimId}:${item.path}`);
  output.verificationCommands = stableSort([...new Set(output.verificationCommands)]);
  output.expansionHandles = stableSort([...new Set(output.expansionHandles)]);
  return output;
}

function uniqueObjects(values) {
  const seen = new Set();
  return values.filter(value => { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function formatPack(pack, { displayName = loadConfig().displayName } = {}) {
  const sections = [
    ["Binding invariants", pack.bindingInvariants],
    ["Current verified facts", pack.currentVerifiedFacts],
    ["Accepted intent", pack.acceptedIntent],
    ["Open conflicts", pack.openConflicts]
  ];
  const lines = [`# ${displayName} routed context`];
  for (const [title, claims] of sections) {
    if (!claims.length) continue;
    lines.push(`\n## ${title}`);
    for (const claim of claims) lines.push(`- [${claim.id}] (${claim.state}, ${claim.authority.kind}) ${claim.statement}`);
  }
  if (pack.verificationCommands.length) {
    lines.push("\n## Verification commands", ...pack.verificationCommands.map(command => `- \`${command}\``));
  }
  if (pack.expansionHandles.length) lines.push(`\nExpand with: ${pack.expansionHandles.map(id => `\`${id}\``).join(", ")}`);
  const dropped = pack.droppedMandatory ?? [];
  if (dropped.length) lines.push(`\nBudget overflow: ${dropped.length} always-inject rule${dropped.length === 1 ? "" : "s"} did not fit this pack and ${dropped.length === 1 ? "remains" : "remain"} binding: ${dropped.map(id => `\`${id}\``).join(", ")}. Expand by id before acting in their area.`);
  return `${lines.join("\n")}\n`;
}

export function currentClaims(ledger) {
  return stableSort(ledger.claims.filter(claim => activeStates.has(claim.state)), claim => claim.id);
}

export function gitHead(root = repoRoot) {
  try { return execFileSync("git", ["-c", `safe.directory=${normalizePath(root)}`, "-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "unknown"; }
}

export function checkEvidence(ledger, { root = repoRoot, runVerification = false, verificationPaths = null } = {}) {
  const results = [];
  const commands = new Map();
  for (const claim of ledger.claims) {
    for (const evidence of claim.evidence) {
      const anchor = resolveAnchor(evidence, root);
      results.push({ claimId: claim.id, state: claim.state, path: evidence.path, ...anchor });
      const pathSelected = !verificationPaths || verificationPaths.has(normalizePath(evidence.path));
      if (runVerification && pathSelected && evidence.verification.command && ["verified", "enforced"].includes(claim.state)) {
        const list = commands.get(evidence.verification.command) ?? [];
        list.push(claim.id);
        commands.set(evidence.verification.command, list);
      }
    }
  }
  const verification = [];
  for (const [command, claimIds] of commands) {
    const result = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", timeout: 600000 });
    verification.push({ command, claimIds, ok: result.status === 0, status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-4000) });
  }
  return { results, verification };
}

export function dashboardSnapshot(ledger, {
  root = repoRoot,
  observedAt = new Date().toISOString(),
  commit = gitHead(root)
} = {}) {
  const checked = checkEvidence(ledger, { root });
  const healthByClaim = new Map();
  for (const health of checked.results) {
    const queue = healthByClaim.get(health.claimId) ?? [];
    queue.push(health);
    healthByClaim.set(health.claimId, queue);
  }
  const claims = stableSort(ledger.claims, claim => claim.id).map(claim => {
    const evidence = claim.evidence.map((anchor, index) => {
      const health = healthByClaim.get(claim.id)?.[index] ?? { ok: false, reason: "evidence health unavailable" };
      return {
        id: `${claim.id}:evidence:${index + 1}`,
        path: anchor.path,
        locator: anchor.locator,
        expectedHash: anchor.normalizedContentHash,
        actualHash: health.actualHash ?? null,
        displayLine: anchor.displayLine,
        resolvedLine: health.line ?? null,
        verifiedAtCommit: anchor.verifiedAtCommit,
        verification: anchor.verification,
        health: health.ok ? "current" : "stale",
        reason: health.reason ?? null
      };
    });
    const staleEvidence = evidence.filter(anchor => anchor.health === "stale");
    const activeStaleEvidence = claim.state === "superseded" ? [] : staleEvidence;
    const needsJudgment = claim.state === "contested"
      || (claim.state === "proposed" && claim.authority.kind === "session");
    return {
      id: claim.id,
      title: claim.title,
      statement: claim.statement,
      kind: claim.kind,
      state: claim.state,
      severity: claim.severity,
      authority: claim.authority,
      scope: claim.scope,
      universal: claim.universal,
      relationships: claim.relationships,
      evidence,
      history: claim.history,
      attention: {
        needsJudgment,
        staleEvidence: activeStaleEvidence.length > 0,
        reasons: [
          ...(claim.state === "contested" ? ["contested claim"] : []),
          ...(claim.state === "proposed" && claim.authority.kind === "session" ? ["explicit user review required"] : []),
          ...activeStaleEvidence.map(anchor => `${anchor.path}: ${anchor.reason}`)
        ]
      }
    };
  });
  const today = observedAt.slice(0, 10);
  const documents = stableSort(ledger.documents, document => document.id).map(document => ({
    ...document,
    available: existsSync(join(root, document.path)),
    expired: document.state === "current" && Boolean(document.reviewBy && document.reviewBy < today)
  }));
  const stateCounts = Object.fromEntries(stableSort(
    [...new Set(claims.map(claim => claim.state))].map(state => [state, claims.filter(claim => claim.state === state).length]),
    pair => pair[0]
  ));
  const visibleAnchors = claims.filter(claim => claim.state !== "superseded").flatMap(claim => claim.evidence);
  const staleAnchors = visibleAnchors.filter(anchor => anchor.health === "stale").length;
  return {
    schemaVersion: 1,
    source: {
      repository: loadConfig(root).repository,
      commit,
      observedAt,
      visibility: "full"
    },
    health: {
      validation: "valid",
      anchors: visibleAnchors.length,
      currentAnchors: visibleAnchors.length - staleAnchors,
      staleAnchors,
      expiredDocuments: documents.filter(document => document.expired).length,
      needsJudgment: claims.filter(claim => claim.attention.needsJudgment).length
    },
    stateCounts,
    claims,
    documents
  };
}

export function writeIfChanged(path, content) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return true;
}

export function listNarrativeFiles(root = repoRoot) {
  const files = [];
  const visit = folder => {
    if (!existsSync(folder)) return;
    for (const entry of stableSort(readdirSync(folder, { withFileTypes: true }), item => item.name)) {
      const absolute = join(folder, entry.name);
      const rel = normalizePath(relative(root, absolute));
      if (entry.isDirectory()) {
        if (["node_modules", "generated", "worktrees"].includes(entry.name)) continue;
        visit(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(rel);
    }
  };
  for (const rootFile of ["README.md", "CLAUDE.md", "AGENTS.md"]) if (existsSync(join(root, rootFile))) files.push(rootFile);
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isFile() && /^HANDOFF-.*\.md$/i.test(entry.name)) files.push(entry.name);
  visit(join(root, "docs"));
  visit(join(root, "deploy", "runbooks"));
  visit(join(root, ".claude", "skills"));
  visit(join(root, "context"));
  return stableSort([...new Set(files)]);
}

export function applyReview(ledger, decisions, { root = repoRoot } = {}) {
  const now = new Date().toISOString();
  for (const decision of decisions) {
    const claim = ledger.claims.find(item => item.id === decision.claimId);
    if (!claim) throw new Error(`unknown claim ${decision.claimId}`);
    if (!decision.sourceSession) throw new Error(`${claim.id} review decision requires a source session`);
    if (!decision.approver?.kind || !decision.approver?.name) throw new Error(`${claim.id} review decision requires an approver`);
    const next = decision.decision === "accept" ? "accepted" : decision.decision === "verify" ? "verified" : decision.decision === "contest" ? "contested" : decision.decision === "supersede" ? "superseded" : null;
    if (!next) throw new Error(`unsupported decision ${decision.decision}`);
    if (["intent", "invariant"].includes(claim.kind) && next === "accepted") {
      if (decision.approver.kind !== "user") throw new Error(`${claim.id} requires explicit user authority`);
      if (!Array.isArray(decision.evidence) || !decision.evidence.length) throw new Error(`${claim.id} user acceptance requires answer evidence`);
    }
    if (!lifecycle.get(claim.state)?.has(next)) throw new Error(`invalid transition ${claim.state} -> ${next} for ${claim.id}`);
    if (next === "verified") {
      if (claim.kind !== "fact") throw new Error(`${claim.id} is not a mechanically verifiable fact`);
      for (const evidence of claim.evidence) {
        const resolved = resolveAnchor(evidence, root);
        if (!resolved.ok) throw new Error(`${claim.id} has stale evidence: ${evidence.path}: ${resolved.reason}`);
      }
      const commands = [...new Set(claim.evidence.map(item => item.verification.command).filter(Boolean))];
      if (!commands.length) throw new Error(`${claim.id} has no declared verification command`);
      for (const command of commands) {
        const result = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", timeout: 600000 });
        if (result.status !== 0) throw new Error(`${claim.id} verification failed: ${command}`);
      }
    }
    const evidence = decision.evidence ?? claim.evidence.map(item => `${item.path}#${item.locator.kind}:${item.locator.value}`);
    claim.history.push({ from: claim.state, to: next, at: decision.timestamp ?? now, actor: decision.approver?.name ?? "unknown", source: decision.sourceSession, note: decision.note ?? "", evidence });
    claim.state = next;
    if (decision.approver?.kind === "user") claim.authority = { kind: "user", source: decision.sourceSession, decidedAt: decision.timestamp ?? now };
  }
  writeFileSync(join(root, "context", "claims.json"), `${JSON.stringify(ledger.claims, null, 2)}\n`, "utf8");
}
