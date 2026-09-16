/**
 * Guard: scan what is about to be committed for secrets and for personal
 * identifiers that leaked into source code.
 *
 * This exists because an author name once reached a shipped source file and
 * turned a release build red. That class of mistake is invisible in review
 * and expensive in CI, and it is trivially catchable from the staged diff.
 *
 * Two tiers, both blocking:
 *   1. Credential shapes (private keys, cloud/API tokens, assigned passwords).
 *      These patterns are generic secret shapes, not personal data, so they
 *      stay hardcoded below.
 *   2. Personal identifiers (machine username, email, home-directory path)
 *      appearing in SOURCE files only — docs, configs and lockfiles are
 *      exempt, because a GitHub URL in a README is not a leak. These are
 *      loaded at runtime from `identity.json` (see loadIdentityPatterns
 *      below) so this file carries no one's actual identity.
 *
 * Returns null to allow, or a string reason to block.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE_EXT = new Set([
  'go', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cs', 'lua', 'php', 'py',
  'rs', 'java', 'kt', 'c', 'cc', 'cpp', 'h', 'hpp', 'html', 'css', 'scss',
  'vue', 'svelte', 'xaml', 'razor', 'sql', 'sh', 'ps1', 'bat', 'cmd',
]);

const CREDENTIAL_PATTERNS = [
  [/-----BEGIN\s+[A-Z ]*PRIVATE KEY-----/, 'a private key block'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bghp_[A-Za-z0-9]{28,}\b/, 'a GitHub personal access token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'a GitHub fine-grained token'],
  [/\bsk-ant-[A-Za-z0-9\-_]{20,}\b/, 'an Anthropic API key'],
  [/\bsk-[A-Za-z0-9\-_]{32,}\b/, 'an OpenAI-shaped API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\bsv_licenseKey\s+[A-Za-z0-9]{10,}/, 'a FiveM server license key'],
];

const PLACEHOLDER =
  /your|xxx+|changeme|example|placeholder|dummy|\.\.\.|<|\$\{|process\.env|getenv|env\(|import\.meta\.env/i;
const ASSIGNED_SECRET =
  /\b(password|passwd|senha|secret|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|private[_-]?key)\b\s*[:=]\s*["']([^"']{8,})["']/i;

/**
 * Personal identifiers are never hardcoded here — this file ships in a public
 * repo. They are read from `identity.json`, resolved relative to this file's
 * own location (never a hardcoded absolute path), so the config travels with
 * whichever checkout runs the hook. See `identity.example.json` for the shape.
 *
 * Missing config is a deliberate, visible degradation, not a silent one: the
 * generic credential-shape checks above keep running, and a one-line warning
 * says personal-identifier scanning is off until the file exists.
 */
function loadIdentityPatterns() {
  const identityPath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'identity.json');

  let config;
  try {
    config = JSON.parse(readFileSync(identityPath, 'utf8'));
  } catch {
    process.stderr.write(
      'leak-scan: hooks/identity.json not found — personal-identifier scanning is ' +
        'disabled until it exists (copy hooks/identity.example.json and fill it in).\n',
    );
    return [];
  }

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [];

  for (const email of config.emails ?? []) {
    patterns.push([new RegExp(`\\b${esc(email)}\\b`, 'i'), 'your personal email address']);
  }
  for (const seg of config.homePathSegments ?? []) {
    patterns.push([
      new RegExp(`[A-Za-z]:[\\\\/]Users[\\\\/]${esc(seg)}\\b`, 'i'),
      `an absolute path from your machine (…\\Users\\${seg})`,
    ]);
  }
  for (const handle of config.gitHubUsernames ?? []) {
    patterns.push([new RegExp(`\\b${esc(handle)}\\b`, 'i'), 'your GitHub username']);
  }
  for (const name of config.usernames ?? []) {
    patterns.push([new RegExp(`\\b${esc(name)}\\b`, 'i'), 'your OS username']);
  }
  return patterns;
}

const IDENTITY_PATTERNS = loadIdentityPatterns();

/**
 * @param command the shell command line being run
 * @param repo    the ALREADY-RESOLVED repository root (see lib/git-command.mjs).
 *                The caller resolves it, because a repo it cannot determine is
 *                a hard block, not a silent skip.
 */
export function check(command, repo) {
  const git = (args) => {
    try {
      return execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'], // execFileSync leaks child stderr otherwise
      });
    } catch {
      return '';
    }
  };

  // `-a` / `-am` stages tracked modifications at commit time, so those are not
  // in the index yet and --cached would miss them entirely.
  const stagesTracked = /\s-[a-zA-Z]*a[a-zA-Z]*\b|--all\b/.test(command);
  let text = git(['diff', '--cached', '--unified=0']);
  if (stagesTracked) text += git(['diff', '--unified=0']);
  if (!text.trim()) return null;

  const findings = [];
  let file = '';
  let ext = '';

  for (const line of text.split('\n')) {
    const header = line.match(/^\+\+\+ b\/(.+)$/);
    if (header) {
      file = header[1];
      ext = (file.split('.').pop() || '').toLowerCase();
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);

    for (const [re, label] of CREDENTIAL_PATTERNS) {
      if (re.test(added)) {
        findings.push({ file, label, line: added.trim().slice(0, 120) });
        break; // the most specific pattern wins; no need to list overlaps
      }
    }
    const assigned = added.match(ASSIGNED_SECRET);
    if (assigned && !PLACEHOLDER.test(assigned[2])) {
      findings.push({
        file,
        label: `an assigned ${assigned[1].toLowerCase()} with a real-looking value`,
        line: added.trim().slice(0, 120),
      });
    }

    if (SOURCE_EXT.has(ext)) {
      for (const [re, label] of IDENTITY_PATTERNS) {
        if (re.test(added)) {
          findings.push({ file, label, line: added.trim().slice(0, 120) });
          break; // one identity hit per line is enough
        }
      }
    }
  }

  if (findings.length === 0) return null;

  const seen = new Set();
  const lines = [];
  for (const f of findings) {
    const key = `${f.file}::${f.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${f.file} — ${f.label}\n    ${f.line}`);
    if (lines.length >= 12) break;
  }

  return (
    `Blocked: the staged diff contains something that should not be committed.\n\n` +
    lines.join('\n') +
    `\n\nUnstage or rewrite those lines, then commit again. If a hit is a false ` +
    `positive, say so explicitly and get the user's call before bypassing — do ` +
    `not disable the hook to get past it.`
  );
}
