#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { formatPack, gitHead, loadLedger, repoRoot as defaultRoot, routeContext, routingBudget, stableJson } from "./ledger.mjs";

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function readState(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return { injected: {} }; }
}

function repositoryState(root) {
  try {
    const status = execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "-C", root, "status", "--short"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }).trim();
    return `Repository: ${gitHead(root).slice(0, 12)}; worktree ${status ? "has local changes" : "clean"}.`;
  } catch { return "Repository state unavailable."; }
}

export function buildHookOutput(event, input, { root = defaultRoot, stateRoot = null } = {}) {
  try {
    const ledger = loadLedger(root);
    const config = loadConfig(root);
    const resolvedStateRoot = stateRoot ?? join(tmpdir(), "context-ledger", config.repository);
    mkdirSync(resolvedStateRoot, { recursive: true });
    const statePath = join(resolvedStateRoot, `${safeName(input.session_id)}.json`);
    const state = readState(statePath);
    let context = "";
    let key = event;

    if (event === "SessionStart") {
      const pack = routeContext(ledger, { prompt: "session start universal invariants critical conflicts", limit: routingBudget });
      context = `${formatPack(pack, { displayName: config.displayName })}\n${repositoryState(root)}\nLedger health: ${ledger.claims.length} claims, ${ledger.documents.length} registered documents.`;
      key = "session-baseline";
    } else if (event === "UserPromptSubmit") {
      const prompt = String(input.prompt ?? "");
      // The per-prompt budget must not sit below the always-inject closure
      // (validated against routingBudget), or arithmetic alone forces routing
      // to drop a rule marked universal on every prompt.
      const pack = routeContext(ledger, { prompt, paths: [], limit: routingBudget });
      context = formatPack(pack, { displayName: config.displayName });
      state.activePack = pack;
      state.activePromptHash = digest(prompt);
      key = `prompt:${state.activePromptHash}`;
    } else if (event === "SubagentStart") {
      const universal = routeContext(ledger, { prompt: "universal invariants critical conflicts", limit: routingBudget });
      const active = state.activePack ?? universal;
      const merged = {
        bindingInvariants: [...universal.bindingInvariants, ...active.bindingInvariants].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index),
        currentVerifiedFacts: active.currentVerifiedFacts,
        acceptedIntent: active.acceptedIntent,
        openConflicts: [...universal.openConflicts, ...active.openConflicts].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index),
        requiredEvidence: active.requiredEvidence,
        verificationCommands: active.verificationCommands,
        expansionHandles: [...new Set([...universal.expansionHandles, ...active.expansionHandles])].sort(),
        droppedMandatory: [...new Set([...(universal.droppedMandatory ?? []), ...(active.droppedMandatory ?? [])])].sort()
      };
      context = formatPack(merged, { displayName: config.displayName });
      key = `subagent:${safeName(input.agent_id)}`;
    } else return null;

    const hash = digest(context);
    if (state.injected[key] === hash) return null;
    state.injected[key] = hash;
    writeFileSync(statePath, stableJson(state), "utf8");
    return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  } catch {
    return null;
  }
}

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  // Windows PowerShell prefixes piped text with a byte-order mark, which
  // JSON.parse rejects. Strip it, or a hand-run from that shell prints nothing.
  const text = data.replace(/^﻿/, "");
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
