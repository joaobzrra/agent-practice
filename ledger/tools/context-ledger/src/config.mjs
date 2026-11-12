import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Same derivation as ledger.mjs:8 — the package locates its project by
// resolving three directories up from its own file. Duplicated rather than
// imported so this module stays the root of the dependency graph.
export const packageRoot = resolve(here, "../../..");

function fallback(root) {
  const name = basename(root);
  return { repository: name.toLowerCase(), displayName: name };
}

/**
 * Read <root>/context/ledger.config.json. Fails open in every direction:
 * a missing file, unreadable file, malformed JSON, or an empty field all fall
 * back to the project directory name. The hook calls this on every prompt, so
 * it must never throw.
 */
export function loadConfig(root = packageRoot) {
  const base = fallback(root);
  const path = join(root, "context", "ledger.config.json");
  if (!existsSync(path)) return base;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const pick = (value, spare) => (typeof value === "string" && value.trim() ? value.trim() : spare);
    return {
      repository: pick(parsed.repository, base.repository),
      displayName: pick(parsed.displayName, base.displayName)
    };
  } catch {
    return base;
  }
}
