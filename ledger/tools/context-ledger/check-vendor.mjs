#!/usr/bin/env node
// Reports whether other copies of this package still match this one.
// Read-only: it never writes or refreshes anything.
//
//   node check-vendor.mjs <other-project>/tools/context-ledger [more copies...]
//
// The package is copied into each project that uses it, so the copies can
// drift. Keep one copy as the source, edit only that one, and run this from it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const targets = process.argv.slice(2);

// Compare content, not bytes. The copies live in separate repositories with
// their own checkout settings, and one of them may not track the files at all,
// so no `.gitattributes` can guarantee matching line endings. A carriage
// return is not vendor drift.
function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function walk(root, base = root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, base));
    else out.push(path.slice(base.length + 1).split("\\").join("/"));
  }
  return out.sort();
}

if (!targets.length) {
  console.error("usage: node check-vendor.mjs <other-project>/tools/context-ledger [more copies...]");
  process.exitCode = 2;
} else {
  let drift = 0;
  for (const target of targets) {
    const mine = join(here, "src");
    let theirs;
    try { theirs = join(target, "src"); statSync(theirs); }
    catch { console.log(`skip (not installed): ${target}`); continue; }
    for (const file of walk(mine)) {
      const a = readFileSync(join(mine, file), "utf8");
      let b;
      try { b = readFileSync(join(theirs, file), "utf8"); }
      catch { console.error(`MISSING  ${target}/src/${file}`); drift += 1; continue; }
      if (normalize(a) !== normalize(b)) { console.error(`DIFFERS  ${target}/src/${file}`); drift += 1; }
    }
  }
  console.log(drift ? `${drift} file(s) drifted` : "vendored copies match");
  process.exitCode = drift ? 1 : 0;
}
