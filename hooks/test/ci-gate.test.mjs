import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS_DIR, 'commit-guards.mjs');
const APPROVE = join(HOOKS_DIR, 'approve-ci-command.mjs');
const REPO = join(tmpdir(), 'ci-gate-test-repo');
const MARKER = join(REPO, 'ci-ran.flag');
// Test copies, so a real ci-commands.json or approvals file is never read or
// written here.
const MAP = join(tmpdir(), 'ci-gate-test-map.json');
const APPROVALS = join(tmpdir(), 'ci-gate-test-approvals.json');
const ENV = { ...process.env, CI_GATE_MAP: MAP, CI_GATE_APPROVALS: APPROVALS };
writeFileSync(MAP, '{}');
rmSync(APPROVALS, { force: true });

function hook(command, cwd = REPO) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8', env: ENV });
  return { code: r.status, err: r.stderr || '', out: r.stdout || '' };
}

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
const approve = (...extra) =>
  spawnSync('node', [APPROVE, REPO, ...extra], { encoding: 'utf8', env: ENV });

// CI commands that leave a marker file, so a test can tell whether CI ran at all.
const PASS = `node -e "require('fs').writeFileSync('ci-ran.flag','');process.exit(0)"`;
const FAIL = `node -e "require('fs').writeFileSync('ci-ran.flag','');console.log('3 tests failed');process.exit(1)"`;

// Writes the per-repo command file. Approved by default, the way the machine's
// owner would; pass false to leave it as an agent would have written it.
function setCi(text, approved = true) {
  mkdirSync(join(REPO, '.claude'), { recursive: true });
  writeFileSync(join(REPO, '.claude', 'ci-command'), text);
  if (approved) approve();
}
function reset() {
  rmSync(REPO, { recursive: true, force: true });
  rmSync(APPROVALS, { force: true });
  mkdirSync(REPO, { recursive: true });
  git(['init', '-q', '.']);
  git(['config', 'user.email', 't@t.t']);
  git(['config', 'user.name', 't']);
  // The marker is a test artefact, not a file the commit "leaves out".
  appendFileSync(join(REPO, '.git', 'info', 'exclude'), 'ci-ran.flag\n');
  writeFileSync(join(REPO, 'app.js'), 'let a = 1;\n');
  writeFileSync(join(REPO, 'lib.js'), 'let b = 1;\n');
  writeFileSync(join(REPO, 'notes.md'), '# notes\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
}
function stage(file, text) {
  writeFileSync(join(REPO, file), text);
  git(['add', file]);
}
const ciRan = () => {
  const ran = existsSync(MARKER);
  rmSync(MARKER, { force: true });
  return ran;
};

let pass = 0, fail = 0;
function expect(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, wanted ${want})`);
}

const COMMIT = 'git commit -F .git/COMMITMSG';

reset();
stage('app.js', 'let a = 2;\n');
expect('no ci-command file: allowed', hook(COMMIT).code, 0);
expect('no ci-command file: CI not run', ciRan(), false);

setCi(PASS);
expect('passing CI: allowed', hook(COMMIT).code, 0);
expect('passing CI: CI ran', ciRan(), true);

setCi(FAIL);
let r = hook(COMMIT);
expect('failing CI: blocked', r.code, 2);
expect('failing CI: output tail in reason', r.err.includes('3 tests failed'), true);
expect('failing CI: names the command source', r.err.includes('.claude/ci-command'), true);
ciRan();

reset();
setCi(FAIL);
stage('notes.md', '# notes\nmore\n');
expect('docs-only commit: allowed despite failing CI', hook(COMMIT).code, 0);
expect('docs-only commit: CI not run', ciRan(), false);

stage('app.js', 'let a = 3;\n');
expect('docs + code commit: blocked', hook(COMMIT).code, 2);
ciRan();

// --- `-a` detection. The staged part is docs only, so whether CI runs depends
// entirely on seeing that `-am` also commits the unstaged code edit.
reset();
setCi(FAIL);
stage('notes.md', '# notes\nmore\n');
writeFileSync(join(REPO, 'app.js'), 'let a = 4;\n'); // modified, NOT staged
expect('staged docs + unstaged code, plain commit: docs-only, allowed', hook(COMMIT).code, 0);
expect('  ...and CI not run', ciRan(), false);
expect('staged docs + unstaged code, -am: blocked', hook('git commit -am "wip"').code, 2);
expect('  ...and CI ran', ciRan(), true);

reset();
setCi(`# the full suite, not single gates\n\n${FAIL}\n${PASS}\n`);
stage('app.js', 'let a = 5;\n');
expect('comment and blank lines skipped, first real line used', hook(COMMIT).code, 2);
ciRan();

setCi(FAIL);
r = hook('git commit -m "use `git` here"');
expect('message-shape block still wins', r.code, 2);
expect('CI skipped when a cheap check already blocks', ciRan(), false);

setCi('   \n# only a comment\n');
expect('approved ci-command with no real line: allowed', hook(COMMIT).code, 0);
expect('approved ci-command with no real line: CI not run', ciRan(), false);

// --- central map
reset();
stage('app.js', 'let a = 6;\n');
const root = git(['rev-parse', '--show-toplevel']).trim(); // forward slashes
writeFileSync(MAP, JSON.stringify({ _readme: 'x', [root]: FAIL }));
expect('map entry: failing CI blocked', hook(COMMIT).code, 2);
expect('map entry: CI ran', ciRan(), true);

writeFileSync(MAP, JSON.stringify({ [root.replace(/\//g, '\\').toUpperCase() + '\\']: FAIL }));
expect('map key matched across case, slashes, trailing slash', hook(COMMIT).code, 2);
ciRan();

writeFileSync(MAP, JSON.stringify({ [root]: FAIL }));
setCi(PASS);
expect('approved per-repo file overrides the map', hook(COMMIT).code, 0);
ciRan();

// --- the per-repo file cannot be used to switch the gate off
// The map says FAIL. Each case is what an agent blocked by it might try.
setCi('exit 0\n', false);
r = hook(COMMIT);
expect('edited per-repo file, not approved: blocked', r.code, 2);
expect('  ...CI not run on the unapproved command', ciRan(), false);
expect('  ...says it is the user\'s call', r.err.includes("user's call"), true);
expect('  ...names the approval command', r.err.includes('approve-ci-command.mjs'), true);

rmSync(join(REPO, '.claude'), { recursive: true, force: true });
r = hook(COMMIT);
expect('approved per-repo file deleted: blocked', r.code, 2);
expect('  ...says it is missing', r.err.includes('now missing'), true);
ciRan();

approve('--revoke');
expect('approval revoked, file gone: the map decides again (blocked by FAIL)', hook(COMMIT).code, 2);
expect('  ...and CI ran', ciRan(), true);

setCi('# none\n');
expect('approved comment-only file: falls through to the map (blocked by FAIL)', hook(COMMIT).code, 2);
ciRan();

rmSync(join(REPO, '.claude'), { recursive: true, force: true });
approve('--revoke');
setCi(PASS, false);
r = hook(COMMIT);
expect('new file in a repo the map already gates: blocked until approved', r.code, 2);
expect('  ...CI not run on it', ciRan(), false);
expect('  ...says it replaces an existing gate', r.err.includes('replaces an existing gate'), true);
rmSync(join(REPO, '.claude'), { recursive: true, force: true });

// --- trust on first use: a checkout the map does not list (a new worktree)
writeFileSync(MAP, '{}');
expect('no file, no record, not in the map: allowed', hook(COMMIT).code, 0);
setCi(FAIL, false); // written by whoever set the checkout up; nobody approved it
expect('first sight, not in the map: honoured without approval (FAIL blocks)', hook(COMMIT).code, 2);
expect('  ...and CI ran', ciRan(), true);
setCi(PASS, false); // the same file, now edited to pass
r = hook(COMMIT);
expect('recorded file edited afterwards: blocked', r.code, 2);
expect('  ...CI not run on the edited command', ciRan(), false);
expect('  ...says it changed', r.err.includes('has changed since it was recorded'), true);
rmSync(join(REPO, '.claude'), { recursive: true, force: true });
expect('recorded file deleted afterwards: blocked', hook(COMMIT).code, 2);
approve('--revoke');
expect('record revoked by the user: allowed again', hook(COMMIT).code, 0);

// --- working-tree advisory: CI passed on files the commit leaves out
reset();
writeFileSync(MAP, JSON.stringify({ [root]: PASS }));
stage('app.js', 'let a = 7;\n');
r = hook(COMMIT);
expect('everything staged: allowed, no advisory', r.code === 0 && r.out === '', true);
ciRan();

writeFileSync(join(REPO, 'lib.js'), 'let b = 2;\n'); // tracked, edited, NOT staged
r = hook(COMMIT);
expect('unstaged tracked edit: still allowed', r.code, 0);
expect('  ...advisory names the file', r.out.includes('additionalContext') && r.out.includes('lib.js'), true);
ciRan();
r = hook('git commit -am "wip"');
expect('same state with -am: no advisory, it commits the edit', r.code === 0 && !r.out.includes('lib.js'), true);
ciRan();

git(['checkout', '-q', '--', 'lib.js']);
writeFileSync(join(REPO, 'new-module.js'), 'export const c = 1;\n'); // untracked
r = hook(COMMIT);
expect('untracked file: advisory names it', r.code === 0 && r.out.includes('new-module.js'), true);
ciRan();
rmSync(join(REPO, 'new-module.js'), { force: true });

writeFileSync(MAP, JSON.stringify({ '/absolute/path/to/some-other-repo': FAIL }));
expect('repo not in map: allowed', hook(COMMIT).code, 0);
expect('repo not in map: CI not run', ciRan(), false);

writeFileSync(MAP, '{ not json');
r = hook(COMMIT);
expect('broken map: blocked, not silently allowed', r.code, 2);
expect('broken map: says so', r.err.includes('not valid JSON'), true);

writeFileSync(MAP, '{}');
writeFileSync(APPROVALS, '{ not json');
r = hook(COMMIT);
expect('broken approvals file: blocked, not silently allowed', r.code, 2);

rmSync(MAP, { force: true });
rmSync(APPROVALS, { force: true });
rmSync(REPO, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
