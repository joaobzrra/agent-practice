// What the commit guards do when one of their own files is broken.
//
// The hooks folder is copied to a temp directory and one file is replaced with
// a module that throws, so the real hooks are never touched. On a confirmed
// commit a broken check must BLOCK; on anything else a broken hook must stay
// out of the way, or it would freeze every shell command.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const WORK = join(tmpdir(), 'fail-closed-test');
const REPO = join(WORK, 'repo');
const MAP = join(WORK, 'map.json');
const APPROVALS = join(WORK, 'approvals.json');
const BROKEN = `throw new Error('boom');\n`;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
writeFileSync(MAP, '{}');
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
git(['init', '-q', '.']);
git(['config', 'user.email', 't@t.t']);
git(['config', 'user.name', 't']);
writeFileSync(join(REPO, 'app.js'), 'let a = 1;\n');
git(['add', '.']);

// A copy of the hooks with one lib file broken. `null` breaks nothing.
function hooksWith(brokenLib) {
  const dir = join(WORK, `hooks-${brokenLib || 'intact'}`);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  cpSync(join(HOOKS_DIR, 'commit-guards.mjs'), join(dir, 'commit-guards.mjs'));
  cpSync(join(HOOKS_DIR, 'lib'), join(dir, 'lib'), { recursive: true });
  if (brokenLib) writeFileSync(join(dir, 'lib', `${brokenLib}.mjs`), BROKEN);
  return join(dir, 'commit-guards.mjs');
}

function run(hook, command) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: REPO });
  const r = spawnSync('node', [hook], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CI_GATE_MAP: MAP, CI_GATE_APPROVALS: APPROVALS },
  });
  return { code: r.status, err: r.stderr || '' };
}

let pass = 0, fail = 0;
function expect(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, wanted ${want})`);
}

const COMMIT = 'git commit -F .git/COMMITMSG';

expect('intact hooks: commit allowed', run(hooksWith(null), COMMIT).code, 0);

for (const lib of ['message-shape', 'leak-scan', 'ci-gate']) {
  const hook = hooksWith(lib);
  const r = run(hook, COMMIT);
  expect(`${lib} broken: commit blocked`, r.code, 2);
  expect(`  ...names the check that crashed`, r.err.includes(`the ${lib} check crashed`), true);
  expect(`${lib} broken: a non-commit command is untouched`, run(hook, 'npm test').code, 0);
}

const noParser = hooksWith('git-command');
let r = run(noParser, COMMIT);
expect('parser broken: commit blocked', r.code, 2);
expect('  ...says the guards could not load', r.err.includes('could not load'), true);
expect('parser broken: git -C commit blocked', run(noParser, `git -C "${REPO}" commit -F .git/COMMITMSG`).code, 2);
expect('parser broken: dry run allowed', run(noParser, 'git commit --dry-run -m "wip"').code, 0);
expect('parser broken: "commit" in a non-git command allowed', run(noParser, 'echo commit').code, 0);
expect('parser broken: unrelated command allowed', run(noParser, 'npm run build').code, 0);

rmSync(WORK, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
