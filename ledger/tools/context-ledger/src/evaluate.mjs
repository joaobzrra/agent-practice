#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { buildHookOutput } from "./hook.mjs";
import { loadLedger, routeContext, stableJson } from "./ledger.mjs";

const ledger = loadLedger();
const critical = new Set(ledger.claims.filter(claim => claim.universal && claim.severity === "critical" && ["accepted", "verified", "enforced", "contested"].includes(claim.state)).map(claim => claim.id));
const routeMs = [];
const failures = [];

for (const scenario of ledger.scenarios) {
  const started = performance.now();
  const pack = routeContext(ledger, { prompt: scenario.prompt, paths: scenario.paths });
  routeMs.push(performance.now() - started);
  const returned = [...pack.bindingInvariants, ...pack.currentVerifiedFacts, ...pack.acceptedIntent, ...pack.openConflicts];
  const ids = new Set(returned.map(claim => claim.id));
  for (const id of [...critical, ...scenario.expectedClaims]) if (!ids.has(id)) failures.push(`${scenario.id} missed ${id}`);
  for (const claim of returned) {
    if (claim.state === "superseded") failures.push(`${scenario.id} returned superseded ${claim.id}`);
    if (!claim.state || !claim.authority || !Array.isArray(claim.provenance)) failures.push(`${scenario.id} omitted provenance/state for ${claim.id}`);
  }
}

const hookRoot = mkdtempSync(join(tmpdir(), "context-ledger-evaluate-"));
const hookMs = [];
for (const scenario of ledger.scenarios) {
  const started = performance.now();
  buildHookOutput("UserPromptSubmit", { session_id: scenario.id, prompt: scenario.prompt }, { stateRoot: hookRoot });
  hookMs.push(performance.now() - started);
}

const stats = values => {
  // A freshly initialised ledger has no scenarios, so there is nothing to time.
  if (!values.length) return { samples: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, minMs: Number(sorted[0].toFixed(3)), medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)), maxMs: Number(sorted.at(-1).toFixed(3)) };
};

process.stdout.write(stableJson({ scenarios: ledger.scenarios.length, criticalInvariants: critical.size, correctnessFailures: failures, latency: { route: stats(routeMs), userPromptHook: stats(hookMs) }, latencyThresholdEnforced: false }));
if (failures.length) process.exitCode = 1;
