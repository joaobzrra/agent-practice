#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { activeStates, fit, gitHead, loadLedger, packCharBudget, packOf, renderPack, renderSessionStart, repoRoot as defaultRoot, routeContext, routingBudget, sessionStartBudget, sessionTailRoom, stableJson, withoutWorktree } from "./ledger.mjs";

// What this hook is for: put the right recorded decisions in front of an
// agent, whole, once.
//
// "Whole" is why every event renders inside packCharBudget. "Once" is why the
// hook keeps a record of what each conversation has been given: one file for
// the main conversation of a session, one for each subagent, since a subagent
// starts with an empty conversation of its own. A claim on that record is not
// sent again until the conversation is emptied by a compaction or a clear, or
// until the claim itself is changed.
//
// One file per conversation, and each conversation writes only its own. A
// subagent still running while the main conversation compacts can then never
// write an old copy of the main record back over the emptied one.

const stateMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function readState(path) {
  let state = {};
  try { state = JSON.parse(readFileSync(path, "utf8")); } catch { /* first event of the conversation, or a file caught mid-write */ }
  if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
  // A record in an older shape, or a damaged one, counts as empty rather
  // than silencing the hook for the rest of the conversation.
  state.known = Array.isArray(state.known) ? state.known.filter(key => /^\S+ [0-9a-f]{12}$/.test(key)) : [];
  return state;
}

// Tool calls run in parallel, so several copies of this hook can finish at
// once for one conversation: twelve files read in one step is twelve hooks.
// Each one therefore applies its change to the record as it is on disk at
// that moment, not to the copy it read when it started, and holds a lock
// file for the millisecond that takes. Without this, half of what a parallel
// step was given went unrecorded and was sent again.
//
// The lock is a courtesy, never a gate: a hook that cannot get it within
// half a second writes anyway, and one left behind by a killed process
// is removed after two seconds.
function updateState(path, change) {
  const lock = `${path}.lock`;
  let held = false;
  for (let attempt = 0; attempt < 100 && !held; attempt += 1) {
    try { closeSync(openSync(lock, "wx")); held = true; }
    catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") break;
      try { if (Date.now() - statSync(lock).mtimeMs > 2000) unlinkSync(lock); } catch { /* released meanwhile */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try { writeState(path, change(readState(path))); }
  finally { if (held) { try { unlinkSync(lock); } catch { /* already gone */ } } }
}

// Writing beside the file and renaming over it means a reader never sees
// half a file.
function writeState(path, state) {
  const draft = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(draft, stableJson(state), "utf8");
    renameSync(draft, path);
  } catch {
    try { unlinkSync(draft); } catch { /* nothing to remove */ }
    writeFileSync(path, stableJson(state), "utf8");
  }
}

// State files are left behind, one per conversation. Nothing else removes them.
function pruneState(folder) {
  try {
    const cutoff = Date.now() - stateMaxAgeMs;
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
    }
  } catch { /* best effort */ }
}

function repositoryState(root) {
  try {
    const status = execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "-C", root, "status", "--short"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }).trim();
    return `Repository: ${gitHead(root).slice(0, 12)}; worktree ${status ? "has local changes" : "clean"}.`;
  } catch { return "Repository state unavailable."; }
}

// The file a tool call touched, as a path inside the project, or null.
// Claude Code passes an absolute path with the platform's separators. Both
// sides go through realpath first: a temp folder or a linked checkout can
// have two spellings, and compared as typed they look like different places.
function projectPath(root, file) {
  if (typeof file !== "string" || !file) return null;
  const real = path => { try { return realpathSync.native(path); } catch { return path; } };
  const inside = relative(real(root), real(resolve(root, file)));
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return null;
  return withoutWorktree(inside.replaceAll("\\", "/"));
}

const union = (...lists) => [...new Set(lists.flat())];

// What a conversation holds is recorded as "id fingerprint", the fingerprint
// being of the state and the statement it was sent. A claim that is edited or
// contested in the middle of a session no longer matches its record, so the
// new wording goes out instead of a pointer to the old one.
const keyOf = claim => `${claim.id} ${digest(`${claim.state}\n${claim.statement}`).slice(0, 12)}`;
const idOf = key => key.split(" ")[0];

// `held`: given, and still worded as given. `changed`: given in another
// wording, so it is sent again. `withdrawn`: given, and since superseded or
// removed, so the conversation is told once that it no longer applies.
function conversation(ledger, keys) {
  const recorded = new Set(keys);
  const seen = new Set(keys.map(idOf));
  const routed = ledger.claims.filter(claim => activeStates.has(claim.state));
  const live = new Set(routed.map(claim => claim.id));
  const held = [];
  const changed = [];
  for (const claim of routed) {
    if (recorded.has(keyOf(claim))) held.push(claim.id);
    else if (seen.has(claim.id)) changed.push(claim.id);
  }
  return { held, changed, withdrawn: [...seen].filter(id => !live.has(id)) };
}

function withdrawal(ledger, ids) {
  if (!ids.length) return "";
  const successors = id => ledger.claims.filter(claim => activeStates.has(claim.state) && claim.relationships.some(item => item.type === "supersedes" && item.target === id)).map(claim => `\`${claim.id}\``);
  const named = ids.slice(0, 8).map(id => {
    const next = successors(id);
    return next.length ? `\`${id}\` (replaced by ${next.slice(0, 2).join(", ")}${next.length > 2 ? ` and ${next.length - 2} more` : ""})` : `\`${id}\``;
  });
  return `\nNo longer in force, though given earlier in this session (superseded or removed since): ${named.join(", ")}${ids.length > 8 ? ` and ${ids.length - 8} more` : ""}\n`;
}

// The record once a message has gone out: what was withdrawn is dropped, so
// it is announced once, and what was sent whole is added.
const after = (keys, withdrawn, pack, sent) => {
  const gone = new Set(withdrawn);
  return recorded(keys.filter(key => !gone.has(idOf(key))), pack, sent);
};

// The record after `ids` were sent whole, fingerprinted from the pack that
// carried them, which is the text the conversation actually received.
function recorded(keys, pack, ids) {
  const sent = new Set(ids);
  const entries = ["bindingInvariants", "currentVerifiedFacts", "acceptedIntent", "openConflicts"].flatMap(key => pack[key] ?? []).filter(entry => sent.has(entry.id));
  return [...keys.filter(key => !sent.has(idOf(key))), ...entries.map(keyOf)];
}

export function buildHookOutput(event, input, { root = defaultRoot, stateRoot = null } = {}) {
  try {
    const ledger = loadLedger(root);
    const config = loadConfig(root);
    const resolvedStateRoot = stateRoot ?? join(tmpdir(), "context-ledger", config.repository);
    mkdirSync(resolvedStateRoot, { recursive: true });
    const session = safeName(input.session_id);
    const mainPath = join(resolvedStateRoot, `${session}.json`);
    const agentPath = input.agent_id ? join(resolvedStateRoot, `${session}.agent-${safeName(input.agent_id)}.json`) : null;
    const displayName = String(config.displayName).slice(0, 120);
    let context = "";
    let save = null;

    if (event === "SessionStart") {
      // A resume restores the conversation, with everything it was given, so
      // it is sent only what changed while it was away: a standing claim that
      // was added or reworded, one that was withdrawn. Usually that is
      // nothing. startup, clear and compact begin with a conversation that
      // holds none of what was sent before. So does a fork as far as this
      // record goes: it is a new session, and is sent again what its parent
      // held.
      const resumed = input.source === "resume";
      if (!resumed) pruneState(resolvedStateRoot);
      const talk = conversation(ledger, resumed ? readState(mainPath).known : []);
      const notice = withdrawal(ledger, talk.withdrawn);
      const rendered = renderSessionStart(ledger, { displayName, known: talk.held, changed: talk.changed, recall: false, budget: sessionStartBudget - notice.length });
      if (resumed && !rendered.text && !notice) return null;
      const active = ledger.claims.filter(claim => activeStates.has(claim.state)).length;
      const tail = `${repositoryState(root)}\nLedger: ${active} active claims, ${ledger.documents.length} registered documents. A claim about a request, or scoped to a file you open or edit, is sent when that happens.`.slice(0, sessionTailRoom - 1);
      context = `${rendered.text || `# ${displayName} routed context\n`}${notice}\n${tail}`;
      save = [mainPath, latest => (resumed
        ? { ...latest, known: after(latest.known, talk.withdrawn, rendered.pack, rendered.full) }
        : { known: recorded([], rendered.pack, rendered.full) })];
    } else if (event === "UserPromptSubmit") {
      const talk = conversation(ledger, readState(mainPath).known);
      const pack = routeContext(ledger, { prompt: String(input.prompt ?? ""), limit: routingBudget, free: talk.held, root });
      const notice = withdrawal(ledger, talk.withdrawn);
      const rendered = renderPack(pack, { displayName, known: talk.held, changed: talk.changed, budget: packCharBudget - notice.length });
      context = rendered.text ? `${rendered.text}${notice}` : notice ? `# ${displayName} routed context\n${notice}` : "";
      // Kept for the subagents this prompt goes on to start: which claims the
      // prompt was about, by id. Their text is read from the ledger when a
      // subagent starts, so a claim superseded in between is not passed on.
      const everywhere = new Set(pack.standing);
      const activeIds = pack.priority.filter(id => !everywhere.has(id));
      save = [mainPath, latest => ({ ...latest, activeIds, known: after(latest.known, talk.withdrawn, pack, rendered.full) })];
    } else if (event === "SubagentStart") {
      const standing = routeContext(ledger, { limit: routingBudget, root });
      const merged = packOf(ledger, union(standing.priority, readState(mainPath).activeIds ?? []), { standing: standing.standing, droppedMandatory: standing.droppedMandatory });
      const rendered = renderPack(merged, { displayName });
      context = rendered.text;
      // Without an id there is no conversation to keep a record for, and the
      // main one must not be written over.
      if (agentPath) {
        const state = readState(agentPath);
        const hash = digest(context);
        if (state.start === hash) return null;
        save = [agentPath, () => ({ start: hash, known: recorded([], merged, rendered.full) })];
      }
    } else if (event === "PostToolUse") {
      // The only event that knows which file is in play, so the only one
      // where a claim's scope.paths can count in a live session.
      const file = projectPath(root, input.tool_input?.file_path ?? input.tool_input?.notebook_path);
      if (!file) return null;
      const statePath = agentPath ?? mainPath;
      const talk = conversation(ledger, readState(statePath).known);
      // Standing claims belong to the start of the conversation, so they do
      // not use up the room a file's own claims need, and they are not sent
      // beside a file unless the file is what they are scoped to.
      const everywhere = routeContext(ledger, { limit: routingBudget, root }).standing;
      const pack = routeContext(ledger, { paths: [file], limit: routingBudget, free: union(talk.held, everywhere), root });
      const hits = new Set(pack.matched);
      const notice = withdrawal(ledger, talk.withdrawn);
      const heading = `# ${displayName} routed context for ${file}`;
      // Claims already given are not even named: a reminder on every file
      // read is noise.
      const rendered = renderPack(pack, {
        displayName,
        known: union(talk.held, pack.standing.filter(id => !hits.has(id))),
        changed: talk.changed,
        heading,
        recall: false,
        budget: packCharBudget - notice.length
      });
      const brought = rendered.full.length || rendered.titled.length;
      if (!brought && !notice) return null;
      context = brought ? `${rendered.text}${notice}` : `${heading.slice(0, 300)}\n${notice}`;
      save = [statePath, latest => ({ ...latest, known: after(latest.known, talk.withdrawn, pack, rendered.full) })];
    } else return null;

    // The record is a convenience. If it cannot be written (a locked file, a
    // full disk), the message built above still goes out; the cost is that
    // the same claims are sent again next time.
    if (save) { try { updateState(...save); } catch { /* send anyway */ } }
    if (!context) return null;
    return { hookSpecificOutput: { hookEventName: event, additionalContext: fit(context) } };
  } catch {
    return null;
  }
}

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  // Windows PowerShell prefixes piped text with a byte-order mark, which
  // JSON.parse rejects. Strip it, or a hand-run from that shell prints nothing.
  const text = data.charCodeAt(0) === 0xFEFF ? data.slice(1) : data;
  return text ? JSON.parse(text) : {};
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const event = process.argv[2] ?? "";
  try {
    const output = buildHookOutput(event, await readStdin());
    if (output) process.stdout.write(JSON.stringify(output));
  } catch {
    // Deliberately fail open and stay silent.
  }
}
