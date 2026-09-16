/**
 * Covers the two guards added on 2026-08-24: deploy freshness and the
 * identifier check. Same self-running shape as commit-guards.test.mjs.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const COMMIT_HOOK = join(HOOKS_DIR, 'commit-guards.mjs');
const ID_HOOK = join(HOOKS_DIR, 'identifier-guard.mjs');
const REPO = join(tmpdir(), 'new-guards-test-repo');
const PROJECT = join(tmpdir(), 'new-guards-test-project'); // stand-in for a project checkout

function run(hook, payload) {
  try {
    const out = execFileSync('node', [hook], { input: JSON.stringify(payload), encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

const bash = (command, cwd = REPO) =>
  run(COMMIT_HOOK, { tool_name: 'Bash', tool_input: { command }, cwd });

const edit = (file_path, new_string) =>
  run(ID_HOOK, { tool_name: 'Edit', tool_input: { file_path, new_string } });

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });

let pass = 0,
  fail = 0;
function expect(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`);
}
const fires = (r) => r.code === 0 && r.out.includes('additionalContext');

// ---------------------------------------------------------------- setup
rmSync(REPO, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
git(['init', '-q', '.']);
git(['config', 'user.email', 't@t.t']);
git(['config', 'user.name', 't']);
writeFileSync(join(REPO, 'a.txt'), 'one\n');
git(['add', '.']);
git(['commit', '-qm', 'init']);

// ------------------------------------------------- deploy freshness: silence
expect('clean tree, ssh read-only -> silent', fires(bash('ssh vps "tail -f /var/log/x"')), false);
expect('clean tree, plain ls -> silent', fires(bash('ls -la')), false);
expect('no transport at all -> silent', fires(bash('git status')), false);

// ------------------------------------------------- deploy freshness: fires
writeFileSync(join(REPO, 'a.txt'), 'one\ntwo\n'); // tracked file now dirty
const dirtyPull = bash('ssh vps "cd /srv/app && git pull && systemctl restart app"');
expect('dirty tree + remote mutation -> fires', fires(dirtyPull), true);
expect('  ...and names the dirty file', dirtyPull.out.includes('a.txt'), true);
expect('  ...and never blocks', dirtyPull.code, 0);
expect('dirty tree + read-only ssh -> still silent', fires(bash('ssh vps "cat /etc/hostname"')), false);
expect('dirty tree + scp -> fires (transport moves files)', fires(bash('scp x.lua vps:/srv/app/')), true);

// A line that also commits must fall through to the commit guards untouched.
const both = bash('git -C ' + REPO + ' commit -F .git/COMMITMSG && ssh vps "systemctl restart app"');
expect('commit+deploy on one line -> not short-circuited by advisory', both.out.includes('additionalContext'), false);

// -------------------------------------------------------- identifier guard
expect(
  'lua + guessed prop name -> fires',
  fires(edit(`${PROJECT}/resources/x.lua`, 'local m = "bkr_prop_weed_drying_01a"')),
  true,
);
expect(
  'lua + ped model -> fires',
  fires(edit(`${PROJECT}/resources/x.lua`, 'SetPedModel("a_m_y_hippy_01")')),
  true,
);
expect(
  'lua + vector3 literal -> fires',
  fires(edit(`${PROJECT}/resources/x.lua`, 'local p = vector3(1093.2, -3195.1, -38.9)')),
  true,
);
expect(
  'lua + rotation call -> fires',
  fires(edit(`${PROJECT}/resources/x.lua`, 'SetEntityRotation(obj, 0.0, 180.0, 180.0, 2, true)')),
  true,
);
expect(
  'lua + ordinary code -> silent',
  fires(edit(`${PROJECT}/resources/x.lua`, 'local function add(a, b) return a + b end')),
  false,
);
expect(
  'non-lua file with prop-shaped string -> silent',
  fires(edit(`${PROJECT}/src/Thing.cs`, 'var s = "prop_watertap_02";')),
  false,
);
expect(
  'Write tool carries content through',
  fires(run(ID_HOOK, { tool_name: 'Write', tool_input: { file_path: 'a.lua', content: '"prop_bench_01a"' } })),
  true,
);
expect(
  'MultiEdit carries edits through',
  fires(
    run(ID_HOOK, {
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'a.lua', edits: [{ new_string: 'x' }, { new_string: '"v_ilev_bk_door"' }] },
    }),
  ),
  true,
);
expect('identifier guard never blocks', edit('a.lua', '"prop_x_01"').code, 0);

// ------------------------------------------------------------------ robustness
function rawIn(hook, text) {
  try {
    execFileSync('node', [hook], { input: text, encoding: 'utf8' });
    return 0;
  } catch (e) {
    return e.status;
  }
}
expect('identifier guard: unparseable stdin allowed', rawIn(ID_HOOK, 'not json'), 0);
expect('commit guard: unparseable stdin still allowed', rawIn(COMMIT_HOOK, 'not json'), 0);
expect('identifier guard: missing file_path allowed', run(ID_HOOK, { tool_name: 'Edit', tool_input: {} }).code, 0);

rmSync(REPO, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
