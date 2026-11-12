import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS_DIR, 'commit-guards.mjs');
const IDENTITY_PATH = join(HOOKS_DIR, 'identity.json');
const REPO = join(tmpdir(), 'commit-guards-test-repo');

// The leak-scan identity check is driven from a test-local identity.json, not
// the real one — this file ships in a public repo and must not carry anyone's
// actual identifiers. Back up and restore any identity.json a developer left
// in place for their own local runs.
const hadIdentity = existsSync(IDENTITY_PATH);
const priorIdentity = hadIdentity ? readFileSync(IDENTITY_PATH, 'utf8') : null;
writeFileSync(
  IDENTITY_PATH,
  JSON.stringify({
    emails: ['testuser@example.com'],
    usernames: ['testuser'],
    gitHubUsernames: ['test-gh-user'],
    homePathSegments: ['testuser'],
  }),
);

function hook(command, cwd = REPO) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  try {
    execFileSync('node', [HOOK], { input: payload, encoding: 'utf8' });
    return { code: 0, err: '' };
  } catch (e) {
    return { code: e.status, err: e.stderr || '' };
  }
}

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });

rmSync(REPO, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
git(['init', '-q', '.']);
git(['config', 'user.email', 't@t.t']);
git(['config', 'user.name', 't']);

let pass = 0, fail = 0;
function expect(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (exit ${got}, wanted ${want})`);
}

// --- message shape, on an empty index so leak-scan is a no-op
expect('plain one-line -m allowed', hook('git commit -m "fix: dongle balance read"').code, 0);
expect('nested quotes blocked', hook('git commit -m "fix the \\"dongle\\" bug"').code, 2);
expect('backtick blocked', hook('git commit -m "use `git` here"').code, 2);
expect('multiline blocked', hook('git commit -m "line one\nline two"').code, 2);
expect('$env interpolation blocked', hook('git commit -m "built by $env:USERNAME"').code, 2);
expect('-F form allowed', hook('git commit -F .git/COMMITMSG').code, 0);
expect('long message blocked', hook(`git commit -m "${'x'.repeat(150)}"`).code, 2);
expect('not a commit allowed', hook('npm run build -m foo').code, 0);
expect('dry-run + clean message allowed', hook('git commit --dry-run -m "wip"').code, 0);

// --- leak scan
writeFileSync(`${REPO}/README.md`, '# x\nhttps://github.com/example-user/example-repo.git\n');
writeFileSync(`${REPO}/ok.ts`, 'const pw = process.env.PW;\n');
git(['add', '-A']);
expect('clean source allowed (README username exempt)', hook('git commit -F .git/COMMITMSG').code, 0);

writeFileSync(`${REPO}/main.go`, 'package main\n// written by testuser\nfunc main(){}\n');
git(['add', '-A']);
const r1 = hook('git commit -F .git/COMMITMSG');
expect('username in .go blocked', r1.code, 2);
expect('  ...names the file', r1.err.includes('main.go') ? 1 : 0, 1);

writeFileSync(`${REPO}/main.go`, 'package main\nfunc main(){}\n');
// Fixture secrets are assembled at runtime, never written as literals: this
// file is itself committed through these guards, and a literal here would trip
// them. The strings below are identical to the real shapes once concatenated.
const FAKE_KEY = ['sk', 'ant', 'abcdefghijklmnopqrstuvwxyz012345'].join('-');
writeFileSync(`${REPO}/cfg.ts`, `const k = "${FAKE_KEY}";\n`);
git(['add', '-A']);
const r2 = hook('git commit -F .git/COMMITMSG');
expect('api key blocked', r2.code, 2);
expect('  ...reported once, not twice', (r2.err.match(/cfg\.ts/g) || []).length, 1);
expect('  ...the secret itself is not echoed', r2.err.includes(FAKE_KEY) ? 1 : 0, 0);
expect('  ...the line number is given instead', r2.err.includes('cfg.ts:1 ') ? 1 : 0, 1);

// A hit lower in a file: the number must be the line in the new file.
writeFileSync(`${REPO}/cfg.ts`, `const a = 1;\nconst b = 2;\nconst k = "${FAKE_KEY}";\n`);
git(['add', '-A']);
const r2b = hook('git commit -F .git/COMMITMSG');
expect('  ...line number follows the hunk header', r2b.err.includes('cfg.ts:3 ') ? 1 : 0, 1);

writeFileSync(`${REPO}/cfg.ts`, 'const k = process.env.K;\n');
const PW_KEYWORD = 'pass' + 'word';
writeFileSync(`${REPO}/creds.ts`, `const ${PW_KEYWORD} = "Tr0ub4dor&3xy";\n`);
git(['add', '-A']);
expect('assigned password blocked', hook('git commit -F .git/COMMITMSG').code, 2);

writeFileSync(`${REPO}/creds.ts`, 'const password = "${process.env.PW}";\n');
git(['add', '-A']);
expect('placeholder password allowed', hook('git commit -F .git/COMMITMSG').code, 0);

// --- both checks firing at once
writeFileSync(`${REPO}/leak.go`, 'package main\n// testuser\n');
git(['add', '-A']);
const r3 = hook('git commit -m "a `bad` message"');
expect('both guards fire together', r3.code, 2);
expect('  ...reports both reasons', r3.err.includes('backtick') && r3.err.includes('leak.go') ? 1 : 0, 1);

// --- the guard judges the MESSAGE, not the shell block around it
// (clean the index first, so only the message check can fire here)
rmSync(`${REPO}/leak.go`, { force: true });
rmSync(`${REPO}/creds.ts`, { force: true });
git(['add', '-A']);
expect(
  'multi-line shell block with a clean message allowed',
  hook(`echo "step one"\necho "step two"\ngit -C "${REPO}" commit -m "fix: dongle balance read"`).code,
  0,
);
expect(
  'multi-line block with a bad message still blocked',
  hook(`echo "setup"\ngit -C "${REPO}" commit -m "fix the \\"dongle\\" bug"`).code,
  2,
);

// --- repo resolution: the payload cwd is the SESSION dir, not where it runs
const NOT_A_REPO = tmpdir();
writeFileSync(`${REPO}/leak.go`, 'package main\n// testuser\n');
git(['add', '-A']);
const r4 = hook(`cd "${REPO}" && git commit -F .git/COMMITMSG`, NOT_A_REPO);
expect('finds the repo from a cd prefix', r4.code, 2);
expect('  ...and names the leaking file', r4.err.includes('leak.go') ? 1 : 0, 1);

const r5 = hook(`git -C "${REPO}" commit -F .git/COMMITMSG`, NOT_A_REPO);
expect('finds the repo from git -C', r5.code, 2);

// An unresolvable repo must BLOCK, never silently allow — a guard that cannot
// see the diff is worse than no guard, because it reads as a pass.
const r6 = hook('git commit -F .git/COMMITMSG', NOT_A_REPO);
expect('unresolvable repo blocks', r6.code, 2);
expect('  ...and says why', r6.err.includes('cannot tell which repository') ? 1 : 0, 1);
expect('  ...and does not dump git usage', r6.err.includes('--no-index') ? 0 : 1, 1);

const r7 = hook('cd "$REPO" && git commit -F .git/COMMITMSG', NOT_A_REPO);
expect('shell variable in path blocks', r7.code, 2);

// --- broken payload must never block
expect('unparseable stdin allowed', (() => {
  try { execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8' }); return 0; }
  catch (e) { return e.status; }
})(), 0);

rmSync(REPO, { recursive: true, force: true });
if (hadIdentity) writeFileSync(IDENTITY_PATH, priorIdentity);
else rmSync(IDENTITY_PATH, { force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
