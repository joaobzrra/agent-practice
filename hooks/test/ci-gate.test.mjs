import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS_DIR, 'commit-guards.mjs');
const REPO = join(tmpdir(), 'ci-gate-test-repo');
const MARKER = join(REPO, 'ci-ran.flag');
// A test map, so a real ci-commands.json is never read or written here.
const MAP = join(tmpdir(), 'ci-gate-test-map.json');
writeFileSync(MAP, '{}');

function hook(command, cwd = REPO) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  try {
    execFileSync('node', [HOOK], { input: payload, encoding: 'utf8', env: { ...process.env, CI_GATE_MAP: MAP } });
    return { code: 0, err: '' };
  } catch (e) {
    return { code: e.status, err: e.stderr || '' };
  }
}

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });

// CI commands that leave a marker file, so a test can tell whether CI ran at all.
const PASS = `node -e "require('fs').writeFileSync('ci-ran.flag','');process.exit(0)"`;
const FAIL = `node -e "require('fs').writeFileSync('ci-ran.flag','');console.log('3 tests failed');process.exit(1)"`;

function setCi(text) {
  mkdirSync(join(REPO, '.claude'), { recursive: true });
  writeFileSync(join(REPO, '.claude', 'ci-command'), text);
}
function reset() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  git(['init', '-q', '.']);
  git(['config', 'user.email', 't@t.t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(REPO, 'app.js'), 'let a = 1;\n');
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

reset();
setCi(FAIL);
writeFileSync(join(REPO, 'app.js'), 'let a = 4;\n'); // modified, NOT staged
expect('-am with unstaged code edit: blocked', hook('git commit -am "wip"').code, 2);
ciRan();

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
expect('ci-command with no real line: allowed', hook(COMMIT).code, 0);
expect('ci-command with no real line: CI not run', ciRan(), false);

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
expect('per-repo file overrides the map', hook(COMMIT).code, 0);
ciRan();
rmSync(join(REPO, '.claude'), { recursive: true, force: true });

writeFileSync(MAP, JSON.stringify({ '/absolute/path/to/some-other-repo': FAIL }));
expect('repo not in map: allowed', hook(COMMIT).code, 0);
expect('repo not in map: CI not run', ciRan(), false);

writeFileSync(MAP, '{ not json');
r = hook(COMMIT);
expect('broken map: blocked, not silently allowed', r.code, 2);
expect('broken map: says so', r.err.includes('not valid JSON'), true);

rmSync(MAP, { force: true });
rmSync(REPO, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
