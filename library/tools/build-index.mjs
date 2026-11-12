#!/usr/bin/env node
// Regenerates INDEX.md (the index agents and people read) and index.json (the
// same data for machines) from document frontmatter. Zero dependencies.
//
// Usage: node tools/build-index.mjs           rebuild the artifacts
//        node tools/build-index.mjs --check   exit 1 if artifacts are stale
//
// Optional third artifact: if tools/dashboard-template.html exists, the builder
// also writes dashboard.html, a single self-contained page with every document
// embedded. The template is any HTML file containing the placeholder
// /*__LIBRARY_DATA__*/ inside a script; it is replaced by one JSON object:
//   { generatedAt: "YYYY-MM-DD", documents: [{ id, title, description, topic,
//     path, tags, updated, status, source, body }] }
// No template ships here. Without one, the dashboard is skipped.
//
// Frontmatter contract (the ONLY frontmatter syntax this library accepts —
// simpler than full YAML on purpose, one `key: value` per line):
//   id           required, immutable, unique across the library, kebab-case
//   title        required, <= 80 chars
//   description  required, <= 200 chars, single line
//   topic        required, must equal the folder the file lives in
//   updated      required, YYYY-MM-DD
//   status       required, "current" or "outdated"
//   tags         optional, [a, b, c]
//   source       optional, free text

import {
  readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOPICS = ["projects", "stacks", "procedures", "gotchas", "evaluations", "references"];
const CHECK = process.argv.includes("--check");

const unquote = (s) => s.replace(/^(['"])(.*)\1$/, "$2");

function parseFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error(`${file}: missing frontmatter block`);
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = unquote(kv[2].trim());
  }
  return fm;
}

function validate(fm, file, topic) {
  const errs = [];
  for (const req of ["id", "title", "description", "topic", "updated", "status"]) {
    if (!fm[req]) errs.push(`missing "${req}"`);
  }
  if (fm.id && !/^[a-z0-9][a-z0-9-]*$/.test(fm.id)) errs.push(`id "${fm.id}" is not kebab-case`);
  if (fm.title && fm.title.length > 80) errs.push(`title exceeds 80 chars`);
  if (fm.description && fm.description.length > 200) errs.push(`description exceeds 200 chars (index budget)`);
  if (fm.description === ">" || fm.description === "|") errs.push(`description uses a YAML block scalar — write it on one line`);
  if (fm.topic && fm.topic !== topic) errs.push(`topic "${fm.topic}" does not match folder "${topic}"`);
  if (fm.status && !["current", "outdated"].includes(fm.status)) errs.push(`status "${fm.status}" is not "current" or "outdated"`);
  if (fm.updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated)) errs.push(`updated "${fm.updated}" is not YYYY-MM-DD`);
  return errs.map((e) => `${file}: ${e}`);
}

// Escape characters that would corrupt a generated markdown link/line.
const mdSafe = (s) => s.replace(/[\r\n]+/g, " ").replace(/([\[\]()\\])/g, "\\$1");

function* mdFiles(dir, rel) {
  // Plain code-unit order, not localeCompare: the order must be the same on
  // every machine, or --check calls a fresh index stale on a different locale.
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort(byName)) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* mdFiles(abs, `${rel}/${entry.name}`);
    else if (/\.md$/i.test(entry.name)) yield { abs, rel: `${rel}/${entry.name}` };
  }
}

const docs = [];
const errors = [];
for (const topic of TOPICS) {
  const dir = join(ROOT, topic);
  if (!existsSync(dir)) continue; // folder not created yet — fine
  if (!statSync(dir).isDirectory()) { errors.push(`${topic} exists but is not a directory`); continue; }
  for (const { abs, rel } of mdFiles(dir, topic)) {
    try {
      const raw = readFileSync(abs, "utf8");
      const fm = parseFrontmatter(raw, rel);
      errors.push(...validate(fm, rel, topic));
      const tags = fm.tags ? fm.tags.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean) : [];
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
      docs.push({ id: fm.id, title: fm.title, description: fm.description, topic, path: rel, tags, updated: fm.updated, status: fm.status, source: fm.source ?? null, body });
    } catch (e) {
      errors.push(e.message);
    }
  }
}

const seen = new Map();
for (const d of docs) {
  if (d.id && seen.has(d.id)) errors.push(`duplicate id "${d.id}": ${seen.get(d.id)} and ${d.path}`);
  seen.set(d.id, d.path);
}

if (errors.length) {
  console.error("Index build FAILED:\n" + errors.map((e) => "  " + e).join("\n"));
  process.exit(1);
}

let md = `# Library index

Generated by \`node tools/build-index.mjs\` — do not edit by hand.
Read this file to find documents; open only what the task needs.

`;
for (const topic of TOPICS) {
  const rows = docs.filter((d) => d.topic === topic);
  if (!rows.length) continue;
  md += `## ${topic}\n\n`;
  md += rows.map((d) => `- [${mdSafe(d.title)}](${d.path}) — ${mdSafe(d.description)}${d.status === "outdated" ? " ⚠ outdated" : ""}`).join("\n");
  md += "\n\n";
}
const manifest = docs.map(({ body, ...rest }) => rest); // index.json stays a lean manifest, no bodies
const json = JSON.stringify({ generated: true, count: docs.length, documents: manifest }, null, 2) + "\n";

const artifacts = [["INDEX.md", md], ["index.json", json]];

// dashboard.html — optional, self-contained readout; bodies embedded so it doubles as a reader.
// generatedAt derives from the docs (not the clock) so output stays deterministic for --check.
const templatePath = join(ROOT, "tools", "dashboard-template.html");
if (existsSync(templatePath)) {
  const generatedAt = docs.map((d) => d.updated).sort().at(-1) ?? "";
  const payload = JSON.stringify({ generatedAt, documents: docs }).replace(/</g, "\\u003c");
  const template = readFileSync(templatePath, "utf8");
  if (!template.includes("/*__LIBRARY_DATA__*/")) {
    console.error("tools/dashboard-template.html: missing /*__LIBRARY_DATA__*/ placeholder");
    process.exit(1);
  }
  // A function, so `$` sequences in a document body are not read as
  // replacement patterns.
  artifacts.push(["dashboard.html", template.replace("/*__LIBRARY_DATA__*/", () => payload)]);
}
const names = artifacts.map(([name]) => name).join(" + ");

function publish(name, content) {
  const tmp = join(ROOT, `.${name}.tmp`);
  writeFileSync(tmp, content);
  renameSync(tmp, join(ROOT, name)); // atomic on the same volume — readers never see a partial file
}

if (CHECK) {
  const stale = [];
  for (const [name, content] of artifacts) {
    const current = existsSync(join(ROOT, name)) ? readFileSync(join(ROOT, name), "utf8") : "";
    if (current !== content) stale.push(name);
  }
  if (stale.length) {
    console.error(`STALE: ${stale.join(", ")} — run: node tools/build-index.mjs`);
    process.exit(1);
  }
  console.log(`Index up to date: ${docs.length} document(s).`);
} else {
  for (const [name, content] of artifacts) publish(name, content);
  console.log(`${names} written: ${docs.length} document(s).`);
}
