import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
  // The same promise, measured in characters. A session start sends the
  // standing claims (universal ones and open conflicts) and nothing else, so
  // if they do not fit one message whole, some rule marked "always" arrives
  // as a title. These are warnings: they describe a ledger that grew, not a
  // record that is wrong.
  //
  // This runs on a ledger that may also have failed its schema, and a claim
  // with no statement or a number for a path cannot be routed at all. The
  // schema error already says so; a stack trace here would bury it.
  try {
    const standing = renderSessionStart({ claims: active });
    const cut = standing.titled.length + standing.omitted;
    if (cut) {
      issues.push({ level: "warning", code: "standing-overflow", message: `the standing claims do not fit the ${sessionStartBudget} characters a session start has for them; ${cut} would start every session as a title only: ${standing.titled.join(", ")}` });
    }
  } catch { /* reported by the schema check */ }
  const long = active.filter(claim => typeof claim.statement === "string" && claim.statement.length > packCharBudget / 3).map(claim => claim.id);
  if (long.length) {
    issues.push({ level: "warning", code: "long-statement", message: `${long.length} statement${long.length === 1 ? " is" : "s are"} longer than ${packCharBudget / 3} characters, a third of what one message holds, and will often arrive as a title only: ${long.join(", ")}` });
  }
  return issues;
}

// Words that carry no subject. Every statement contains several, so while
// they scored, any prompt at all matched most of a ledger: measured on five
// real ledgers, the median prompt pack was already at the 24-claim cap.
// English only, and deliberately short: a word that can be a subject ("set",
// "test", "new") stays out of this list.
const stopWords = new Set((
  "the and for with that this from are was were not but you all can has have had its any one out into " +
  "when then than them they will would should could must may also only each more most how what why who " +
  "which where does did been being our your their there here about after before because while without " +
  "within just some such these those very too yet every other another both either neither nor whether " +
  "over under through between during until since per via off onto upon itself she her him his whose whom " +
  "same own still even ever again now many much few"
).split(" "));

// Dots, slashes, dashes and underscores stay inside a token so that a file
// name or an identifier matches as one word, but not at its edges: "email."
// at the end of a sentence is the word "email".
function tokens(value) {
  return new Set(
    value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .split(/[^a-z0-9_.\/-]+/)
      .map(token => token.replace(/^[._\/-]+|[._\/-]+$/g, ""))
      .filter(token => token.length > 2 && !stopWords.has(token))
  );
}

// Paths are compared without case and without a trailing slash: Windows
// hands over "Src\Jobs" for what a claim scoped as "src/jobs/".
function comparablePath(value) {
  return normalizePath(value).toLowerCase().replace(/\/+$/, "");
}

// True when `child` is `parent` or sits inside it. A plain prefix test is
// not enough: "src/application" starts with "src/app" and is not inside it.
function under(child, parent) {
  return child === parent || child.startsWith(`${parent}/`);
}

// A session in the main checkout can start a subagent in a worktree, which
// Claude Code creates at <project>/.claude/worktrees/<name>. A file there is
// the same file as far as a claim's scope is concerned.
export function withoutWorktree(path) {
  return path.replace(/^\.claude\/worktrees\/[^/]+\/(?=.)/, "");
}

// File paths written in a prompt, so that "why does src/jobs/reminders.js
// send twice" retrieves the claims scoped to that file. Only two shapes
// count: something with a slash in it, or a bare file name with an
// extension. A lone word is never a path, even when a folder has that name.
//
// The shapes people and tools actually write are all read as the path:
// "@src/jobs/reminders.js" (a file mention), "src/jobs/reminders.js:42:7" and
// "file:///X:/app/src/jobs/reminders.js:3:5" (stack frames),
// "src/jobs/reminders.js:42-50" (a line range), "./src/jobs" and
// "src/jobs/reminders.js." at the end of a sentence. A path under
// ".claude/worktrees/<name>/" is read as the project file it is a copy of.
//
// Prose is full of slashes that are not paths: "client/server", "and/or",
// "@types/node", "1/2". So something with a slash counts only when it ends
// in a file name with an extension, or names a file or folder that exists in
// the project. An absolute path inside `root` is made relative to it, and
// "/docs/setup.md" is read from the project root when that file is there.
// Any other absolute path is returned as it is, absolute, which marks it as
// coming from somewhere else: see mentionHits.
const outsidePath = value => value.startsWith("/") || /^[a-z]:\//.test(value);

// A prompt can be a megabyte of pasted log. The question in it is at the top
// or at the bottom, so past this many distinct path-like chunks only the
// first and last halves are looked at. That bounds both the file lookups
// here and the matching against every claim's scope afterwards.
const mentionLimit = 400;

export function mentionedPaths(prompt, root = repoRoot) {
  // The same folder as Git Bash and WSL spell it: /c/work/app, /mnt/c/work/app.
  const bases = [...new Set([root, realPath(root)].map(comparablePath).filter(Boolean).flatMap(base => {
    const drive = base.match(/^([a-z]):\/(.+)$/);
    return drive ? [base, `/${drive[1]}/${drive[2]}`, `/mnt/${drive[1]}/${drive[2]}`] : [base];
  }))];
  const fileName = /^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)*\.[a-z][a-z0-9]{0,7}$/u;
  const seen = new Set();
  for (const chunk of String(prompt).match(/[\p{L}\p{N}_.~:@\\\/-]+/gu) ?? []) {
    let text = chunk.replace(/^@+/, "");
    // "file:///X:/app/x.js" is how Node prints a module's path in a stack.
    if (/^file:\/\//i.test(text)) text = text.replace(/^file:\/\/+/i, "/").replace(/^\/(?=[A-Za-z]:[\\/])/, "");
    else if (text.includes("://")) continue;
    const value = withoutWorktree(comparablePath(text).replace(/[.:]+$/, "").replace(/(:\d+(-\d+)?){1,2}$/, "").replace(/^:+/, ""));
    if (value.includes("/") ? value.split("/").filter(Boolean).length > 1 : fileName.test(value)) seen.add(value);
  }
  let candidates = [...seen];
  if (candidates.length > mentionLimit) candidates = [...candidates.slice(0, mentionLimit / 2), ...candidates.slice(-mentionLimit / 2)];
  const exists = path => { try { return existsSync(join(root, path)); } catch { return false; } };
  const found = new Set();
  for (let value of candidates) {
    if (outsidePath(value)) {
      const base = bases.find(candidate => value.startsWith(`${candidate}/`));
      if (base) value = withoutWorktree(value.slice(base.length + 1));
      else if (value.startsWith("/") && exists(value.replace(/^\/+/, ""))) value = value.replace(/^\/+/, "");
      if (value) found.add(value);
    } else if (!value.includes("/") || /\.[a-z][a-z0-9]{0,7}$/.test(value.split("/").at(-1)) || exists(value)) found.add(value);
  }
  return [...found];
}

function realPath(path) {
  try { return realpathSync.native(path); } catch { return path; }
}

// A path from a prompt is matched more loosely than one from a tool call.
// A bare file name matches a scope that ends in it. A project path matches
// like a tool path, or as the tail of a scope ("jobs/reminders.js"). A path
// from somewhere else ("/app/src/jobs/reminders.js" in a stack trace) is
// matched by what it contains, and only against a scope of two segments or
// more: "/usr/share/docs/readme.txt" is not this project's "docs".
function mentionHits(mention, claimPath) {
  if (!mention.includes("/")) return claimPath === mention || claimPath.endsWith(`/${mention}`);
  if (outsidePath(mention)) return claimPath.includes("/") && (mention.endsWith(`/${claimPath}`) || mention.includes(`/${claimPath}/`));
  return under(mention, claimPath) || under(claimPath, mention) || claimPath.endsWith(`/${mention}`);
}

// The smallest claim budget any hook event routes with. Validation checks the
// always-inject closure against this number, so a ledger that can no longer
// honour "universal means always injected" fails `validate` instead of
// silently dropping a rule at runtime.
//
// 24 is chosen, not inherited: the largest ledger this ran on had an
// always-inject closure of 22 when the number was set, and a budget at or
// below the closure drops a mandatory claim by arithmetic alone. The headroom
// is deliberately two, so the next pair of universal flags is admitted and the
// pair after that trips validation instead of quietly buying prompt weight.
// This caps how many claims a pack names. How many of them arrive as whole
// statements is a separate limit, in characters: see packCharBudget.
export const routingBudget = 24;

// The most a hook may send. Claude Code caps a hook's context at 10,000
// characters; past that it saves the text to a file and shows the agent a
// path and the first 2,000 characters, and nothing tells the agent to open
// the file. Before this limit existed, nine out of ten packs sent by real
// projects were replaced that way. The cap has no setting, so the pack has to
// fit: 9,000 leaves room for the lines a hook adds around it.
export const packCharBudget = 9000;

// A session start also carries two lines about the repository and the
// ledger, so the standing claims get this much. `validate` measures them
// against the same number the hook renders with, through the same function.
export const sessionTailRoom = 400;
export const sessionStartBudget = packCharBudget - sessionTailRoom;

export const severityRank = new Map([["critical", 3], ["high", 2], ["medium", 1], ["low", 0]]);

// A word in the title, topics or entities says what the claim is about and
// scores 4. The same word found only in the statement may be a passing
// mention and scores 2. A path scores 12, more than any few words.
//
// A match below matchFloor counts as no match. One word shared with a
// statement is usually an accident: statements are prose, and "read", "first"
// or "file" turn up in most of them. Replaying real sessions, dropping those
// cut what a prompt was sent by 15 to 25 percent, and every scenario of the
// five ledgers it was measured on still passed. It takes one word the claim
// is about, two words from its statement, or a path.
//
// `match` is the part of the score that came from the prompt or the paths;
// a contested claim gets 3 on top so that an open question is never missed.
const matchFloor = 4;

function scoreClaim(claim, promptTokens, pathValues, mentions) {
  let match = 0;
  const about = tokens([...claim.scope.topics, ...claim.scope.entities, claim.title].join(" "));
  for (const token of about) if (promptTokens.has(token)) match += 4;
  for (const token of tokens(claim.statement)) if (!about.has(token) && promptTokens.has(token)) match += 2;
  for (const claimPath of claim.scope.paths.map(comparablePath)) {
    for (const inputPath of pathValues) if (under(inputPath, claimPath) || under(claimPath, inputPath)) match += 12;
    if (mentions.some(mention => mentionHits(mention, claimPath))) match += 12;
  }
  if (match < matchFloor) match = 0;
  return { match, score: match + (claim.state === "contested" ? 3 : 0) };
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

/**
 * Choose the claims for a prompt and a set of paths.
 *
 * `limit` caps how many claims the pack holds. `free` lists ids that do not
 * count against it: a hook passes the claims a conversation already has, so
 * that the cap applies to what is new and a session full of universal claims
 * still has room for the ones a file brings. `root` is the project folder,
 * used to read an absolute path written in the prompt.
 *
 * Beside the four lists, the pack says `priority` (admission order),
 * `standing` (claims that are in every pack whatever was asked), `matched`
 * (claims the prompt or the paths actually hit) and `cut` (the id and title
 * of each claim the cap left out, best first, so a caller can name them).
 */
export function routeContext(ledger, { prompt = "", paths = [], limit = 24, free = [], root = repoRoot } = {}) {
  const promptTokens = tokens(prompt);
  const normalizedPaths = paths.map(comparablePath).filter(Boolean);
  const mentions = mentionedPaths(prompt, root);
  const uncounted = new Set(free);
  const eligible = ledger.claims.filter(claim => activeStates.has(claim.state));
  const scores = new Map(eligible.map(claim => [claim.id, scoreClaim(claim, promptTokens, normalizedPaths, mentions)]));
  const components = conflictComponents(eligible).map(members => ({
    members,
    mandatory: members.some(member => member.universal),
    severity: Math.max(...members.map(member => severityRank.get(member.severity) ?? 0)),
    score: Math.max(...members.map(member => scores.get(member.id).score)),
    matched: members.some(member => scores.get(member.id).match > 0)
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
  // Standing claims are in the pack whatever was asked: universal ones, and
  // open conflicts the prompt did not name. A hook sends them once, at the
  // start of a session, and does not treat them as news on every prompt.
  const standing = [];
  const cut = [];
  let used = 0;
  for (const component of candidates) {
    const cost = component.members.filter(member => !uncounted.has(member.id)).length;
    if (cost && used + cost > limit) {
      if (component.mandatory) droppedMandatory.push(...component.members.map(member => member.id));
      else cut.push(...component.members.map(member => ({ id: member.id, title: member.title })));
      continue;
    }
    used += cost;
    selected.push(...component.members);
    if (component.mandatory || !component.matched) standing.push(...component.members.map(member => member.id));
  }
  const matched = eligible.filter(claim => scores.get(claim.id).match > 0).map(claim => claim.id);
  return assemble(selected, { droppedMandatory: stableSort([...new Set(droppedMandatory)]), standing: stableSort(standing), matched: stableSort(matched), cut });
}

/**
 * A pack of exactly these claims, in this order, as the ledger has them now.
 * An id that is gone, or whose claim is no longer in a routed state, is left
 * out. A hook uses this to give a subagent the claims of the prompt that
 * started it without keeping a copy of their text, which would go stale the
 * moment one of them was superseded.
 */
export function packOf(ledger, ids, extra = {}) {
  const byId = new Map(ledger.claims.map(claim => [claim.id, claim]));
  const selected = [...new Set(ids)].map(id => byId.get(id)).filter(claim => claim && activeStates.has(claim.state));
  return assemble(selected, { droppedMandatory: [], standing: [], matched: [], cut: [], ...extra });
}

function assemble(selected, { droppedMandatory, standing, matched, cut }) {
  const classify = claim => claim.state === "contested" || claim.kind === "conflict" ? "openConflicts"
    : claim.kind === "invariant" ? "bindingInvariants"
      : claim.kind === "intent" ? "acceptedIntent"
        : "currentVerifiedFacts";
  // `priority` is the order the claims were admitted in, most relevant first.
  // The four lists below are sorted by id so that a pack is stable to diff;
  // anything that has to choose between claims reads `priority` instead.
  const output = { bindingInvariants: [], currentVerifiedFacts: [], acceptedIntent: [], openConflicts: [], requiredEvidence: [], verificationCommands: [], expansionHandles: [], droppedMandatory, priority: selected.map(claim => claim.id), standing, matched, cut };
  for (const claim of selected) {
    const compact = { id: claim.id, title: claim.title, statement: claim.statement, state: claim.state, authority: claim.authority, provenance: claim.evidence.map(item => ({ path: item.path, locator: item.locator, verifiedAtCommit: item.verifiedAtCommit })) };
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

const packSections = [
  ["bindingInvariants", "Binding invariants"],
  ["currentVerifiedFacts", "Current verified facts"],
  ["acceptedIntent", "Accepted intent"],
  ["openConflicts", "Open conflicts"]
];

// The command an agent runs to read one claim whole. Derived from where this
// file sits, which is always tools/context-ledger/src inside the project.
const expandCommand = `node ${normalizePath(relative(repoRoot, join(here, "cli.mjs")))} expand --claim <id>`;

/**
 * Turn a routed pack into the text a session receives, inside `budget`
 * characters.
 *
 * Whole statements are given in `pack.priority` order for as long as they
 * fit. A claim that does not fit is listed by title, so the agent knows it
 * exists and can expand it; titles that do not fit either are counted. A long
 * claim is skipped rather than cut, because half a rule reads as a whole one.
 *
 * `known` holds the ids this conversation was already given whole. They are
 * not repeated: a matched one is named in a single line, a standing one is
 * left out, since it was not chosen for this prompt in the first place.
 *
 * `changed` holds ids the conversation was given in an earlier wording. They
 * are sent again like new ones, and named, so the agent knows which of two
 * texts in its context is the current one.
 *
 * Returns the text and what happened to each claim, so the caller can record
 * which ones the conversation now holds. The text is empty when there is
 * nothing to say.
 */
export function renderPack(pack, { displayName = loadConfig().displayName, budget = packCharBudget, known = [], changed = [], heading = `# ${displayName} routed context`, recall = true } = {}) {
  const claims = new Map();
  const sectionOf = new Map();
  for (const [key] of packSections) for (const claim of pack[key] ?? []) { claims.set(claim.id, claim); sectionOf.set(claim.id, key); }
  // A pack saved by an older version of this tool has no priority list.
  const order = [...new Set([...(pack.priority ?? []), ...claims.keys()])].filter(id => claims.has(id));
  const held = new Set(known);
  const standing = new Set(pack.standing ?? []);
  const fresh = order.filter(id => !held.has(id));
  const again = recall ? order.filter(id => held.has(id) && !standing.has(id)) : [];
  // The lines around the claims are kept short whatever the ledger holds,
  // so that they can never take the room of a claim the conversation has not
  // seen. In a long session on a large ledger, a prompt can match a hundred
  // claims already given; the most relevant few are named and the rest
  // counted.
  // The schema puts no limit on the length of an id, so a list of ids that
  // is long anyway is replaced by a count.
  const few = (ids, most) => {
    const listed = `${ids.slice(0, most).map(id => `\`${id}\``).join(", ")}${ids.length > most ? ` and ${ids.length - most} more` : ""}`;
    return listed.length <= 2000 ? listed : `${ids.length} claim${ids.length === 1 ? "" : "s"}, with ids too long to list here`;
  };
  const head = heading.slice(0, 300);
  const dropped = pack.droppedMandatory ?? [];
  // Claims that matched and that the cap on a pack left out. They are never
  // given whole here, and they are named by title while there is room:
  // silence would read as "nothing else applies".
  const beyond = (pack.cut ?? []).filter(item => !held.has(item.id) && !claims.has(item.id));
  const past = new Set(beyond.map(item => item.id));
  const titles = new Map([...beyond.map(item => [item.id, item.title]), ...[...claims].map(([id, claim]) => [id, claim.title])]);
  const listable = [...fresh, ...past];
  if (!listable.length && !again.length && !dropped.length) return { text: "", full: [], titled: [], again: [], omitted: 0 };

  const compose = (full, titled, omitted) => {
    const lines = [head];
    for (const [key, title] of packSections) {
      const members = fresh.filter(id => full.has(id) && sectionOf.get(id) === key);
      if (!members.length) continue;
      lines.push(`\n## ${title}`);
      for (const id of members) { const claim = claims.get(id); lines.push(`- [${id}] (${claim.state}, ${claim.authority.kind}) ${claim.statement}`); }
    }
    if (titled.length || omitted) {
      lines.push("\n## Also matched, by title only", `These did not fit in this message. Before acting in one's area, read it whole: \`${expandCommand}\``);
      for (const id of titled) lines.push(titles.get(id) ? `- [${id}] ${titles.get(id)}` : `- [${id}]`);
      if (omitted) lines.push(`- and ${omitted} more matched that are not listed`);
    }
    const reworded = changed.filter(id => full.has(id));
    if (reworded.length) lines.push(`\nChanged since it was given earlier in this session, and the wording above is the current one: ${few(reworded, 24)}`);
    if (again.length) lines.push(`\nGiven earlier in this session and relevant again: ${few(again, 8)}`);
    if (dropped.length) lines.push(`\nBudget overflow: ${dropped.length} always-inject rule${dropped.length === 1 ? "" : "s"} did not fit this pack and ${dropped.length === 1 ? "remains" : "remain"} binding: ${few(dropped, 24)}. Expand by id before acting in their area.`);
    return `${lines.join("\n")}\n`;
  };

  // First every claim is named, by title, as far as titles fit. Then titles
  // are traded up to whole statements, most relevant first. A statement too
  // long for the room left keeps its title and a shorter one further down
  // may still fit.
  const titled = [];
  for (const id of fresh) {
    if (compose(new Set(), [...titled, id], listable.length - titled.length - 1).length > budget) break;
    titled.push(id);
  }
  let omitted = listable.length - titled.length;
  const full = new Set();
  for (const id of titled) {
    const trial = new Set(full).add(id);
    if (compose(trial, titled.filter(other => !trial.has(other)), omitted).length <= budget) full.add(id);
  }
  // Last, and only in the room that is left: the titles of the claims past
  // the cap. They never cost a chosen claim its statement.
  const remaining = titled.filter(id => !full.has(id));
  if (titled.length === fresh.length) {
    for (const id of past) {
      if (compose(full, [...remaining, id], omitted - 1).length > budget) break;
      remaining.push(id);
      omitted -= 1;
    }
  }
  let text = compose(full, remaining, omitted);
  // Verification commands are a convenience and go in only when there is room.
  const commands = full.size && pack.verificationCommands?.length ? `\n## Verification commands\n${pack.verificationCommands.map(command => `- \`${command}\``).join("\n")}\n` : "";
  if (commands && text.length + commands.length <= budget) text += commands;
  return { text, full: [...full], titled: remaining, again, omitted };
}

/**
 * The last line of defence for "a message always fits", applied by the hook
 * to everything it sends. renderPack builds a message to size, claim by
 * claim. What the hook adds around it (the line that withdraws claims, a
 * heading) is made of ids and names, and the schema puts no limit on their
 * length. A text that is still too long is cut at the end of a line and says
 * so, which is still better than what happens past the cap: the agent is
 * shown the first fifth and a file path.
 */
export function fit(text, budget = packCharBudget) {
  if (text.length <= budget) return text;
  const note = "\n(Cut here: the rest did not fit in one message.)\n";
  const room = Math.max(0, budget - note.length);
  const end = text.lastIndexOf("\n", room);
  return `${text.slice(0, end > 0 ? end : room)}${note}`;
}

export function formatPack(pack, options = {}) {
  return renderPack(pack, options).text;
}

// What opens a session: the standing claims and nothing else, since there is
// no prompt yet. Universal ones and open conflicts.
export function renderSessionStart(ledger, options = {}) {
  const pack = routeContext(ledger, { limit: routingBudget });
  return { ...renderPack(pack, { budget: sessionStartBudget, ...options }), pack };
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
