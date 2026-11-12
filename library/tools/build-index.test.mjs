// Tests for build-index.mjs. The builder finds its library from its own
// location, so each case copies it into a fresh temp library and runs the
// copy. The real library next to this file is never read or written.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILDER = join(dirname(fileURLToPath(import.meta.url)), 'build-index.mjs');
// A fresh folder per run, so two runs on one machine cannot collide.
const WORK = mkdtempSync(join(tmpdir(), 'library-builder-test-'));

const GOOD = {
  id: 'first-doc',
  title: 'First document',
  description: 'The one line an agent decides from.',
  topic: 'gotchas',
  tags: '[alpha, beta]',
  updated: '2026-01-02',
  status: 'current',
};

function doc(fields, body = '# Title\n\nBody text.\n', eol = '\n') {
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return ['---', ...fm, '---', '', ...body.split('\n')].join(eol);
}

// A fresh library holding the given files: { 'gotchas/a.md': '...' }.
function library(files) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, 'tools'), { recursive: true });
  cpSync(BUILDER, join(WORK, 'tools', 'build-index.mjs'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(WORK, rel)), { recursive: true });
    writeFileSync(join(WORK, rel), text);
  }
}
function build(...args) {
  const r = spawnSync('node', [join(WORK, 'tools', 'build-index.mjs'), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const read = (rel) => readFileSync(join(WORK, rel), 'utf8');

let pass = 0, fail = 0;
function expect(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, wanted ${want})`);
}

// --- a valid library
library({ 'gotchas/first.md': doc(GOOD), 'procedures/second.md': doc({ ...GOOD, id: 'second-doc', title: 'Second [draft]', topic: 'procedures', status: 'outdated' }) });
let r = build();
expect('valid library: builds', r.code, 0);
expect('  ...INDEX.md has the line an agent reads', read('INDEX.md').includes('- [First document](gotchas/first.md) — The one line an agent decides from.'), true);
expect('  ...brackets in a title are escaped', read('INDEX.md').includes('Second \\[draft\\]'), true);
expect('  ...an outdated document is flagged', read('INDEX.md').includes('⚠ outdated'), true);
expect('  ...folders appear in the fixed order', read('INDEX.md').indexOf('## procedures') < read('INDEX.md').indexOf('## gotchas'), true);

// --- file order is the same on every machine (code units, not locale)
library({ 'gotchas/b.md': doc({ ...GOOD, id: 'b-doc', title: 'Lower b' }), 'gotchas/C.md': doc({ ...GOOD, id: 'c-doc', title: 'Upper C' }), 'gotchas/a.md': doc({ ...GOOD, id: 'a-doc', title: 'Lower a' }) });
build();
expect('mixed-case file names: uppercase first, then lowercase in order', JSON.parse(read('index.json')).documents.map((d) => d.id).join(','), 'c-doc,a-doc,b-doc');
library({ 'gotchas/first.md': doc(GOOD), 'procedures/second.md': doc({ ...GOOD, id: 'second-doc', title: 'Second [draft]', topic: 'procedures', status: 'outdated' }) });
build();
const manifest = JSON.parse(read('index.json'));
expect('  ...index.json counts the documents', manifest.count, 2);
expect('  ...index.json parses tags', manifest.documents.find((d) => d.id === 'first-doc').tags.join(','), 'alpha,beta');
expect('  ...index.json carries no bodies', read('index.json').includes('Body text'), false);
expect('  ...no dashboard without a template', existsSync(join(WORK, 'dashboard.html')), false);

// --- --check
expect('--check right after a build: fresh', build('--check').code, 0);
writeFileSync(join(WORK, 'gotchas', 'first.md'), doc({ ...GOOD, description: 'Changed.' }));
r = build('--check');
expect('--check after a document changed: stale', r.code, 1);
expect('  ...names the stale files', r.err.includes('STALE: INDEX.md, index.json'), true);
expect('  ...and writes nothing', read('INDEX.md').includes('Changed.'), false);
writeFileSync(join(WORK, 'gotchas', 'first.md'), doc(GOOD, '# Title\n\nA different body.\n'));
expect('--check after only a body changed: still fresh', build('--check').code, 0);

// --- CRLF documents parse the same
library({ 'gotchas/first.md': doc(GOOD, undefined, '\r\n') });
expect('a CRLF document: builds', build().code, 0);
expect('  ...with no stray carriage return in the index', read('INDEX.md').includes('\r'), false);

// --- an empty library
library({});
expect('no documents at all: builds an empty index', build().code, 0);
expect('  ...count is 0', JSON.parse(read('index.json')).count, 0);

// --- every rule the builder enforces
const broken = [
  ['missing id', { ...GOOD, id: '' }, 'missing "id"'],
  ['missing description', { ...GOOD, description: '' }, 'missing "description"'],
  ['id not kebab-case', { ...GOOD, id: 'First_Doc' }, 'is not kebab-case'],
  ['title over 80 characters', { ...GOOD, title: 'x'.repeat(81) }, 'title exceeds 80 chars'],
  ['description over 200 characters', { ...GOOD, description: 'x'.repeat(201) }, 'description exceeds 200 chars'],
  ['description as a YAML block scalar', { ...GOOD, description: '>' }, 'block scalar'],
  ['topic does not match the folder', { ...GOOD, topic: 'stacks' }, 'does not match folder "gotchas"'],
  ['unknown status', { ...GOOD, status: 'draft' }, 'is not "current" or "outdated"'],
  ['date not YYYY-MM-DD', { ...GOOD, updated: '02/01/2026' }, 'is not YYYY-MM-DD'],
];
for (const [name, fields, message] of broken) {
  library({ 'gotchas/first.md': doc(fields) });
  r = build();
  expect(`${name}: rejected`, r.code, 1);
  expect(`  ...says why and where`, r.err.includes(message) && r.err.includes('gotchas/first.md'), true);
  expect(`  ...and writes no index`, existsSync(join(WORK, 'INDEX.md')), false);
}

library({ 'gotchas/first.md': 'No frontmatter here.\n' });
r = build();
expect('no frontmatter block: rejected', r.code === 1 && r.err.includes('missing frontmatter block'), true);

library({ 'gotchas/first.md': doc(GOOD), 'gotchas/copy.md': doc(GOOD) });
r = build();
expect('duplicate id: rejected', r.code === 1 && r.err.includes('duplicate id "first-doc"'), true);

library({ 'gotchas/first.md': doc({ ...GOOD, title: 'x'.repeat(81), status: 'draft' }) });
r = build();
expect('two faults in one document: both reported', r.err.includes('title exceeds') && r.err.includes('is not "current"'), true);

// --- files outside the known folders are not documents
library({ 'gotchas/first.md': doc(GOOD), 'README.md': '# Not a document\n', 'notes/scratch.md': 'no frontmatter\n' });
expect('a README and an unknown folder: ignored', build().code, 0);
expect('  ...and not counted', JSON.parse(read('index.json')).count, 1);

// --- the optional dashboard
library({ 'gotchas/first.md': doc(GOOD, '# Title\n\nCosts $1 and has a <script> in it.\n'), 'tools/dashboard-template.html': '<script>const DATA=/*__LIBRARY_DATA__*/;</script>\n' });
expect('with a dashboard template: builds', build().code, 0);
const dash = read('dashboard.html');
expect('  ...the body is embedded', dash.includes('Costs $1 and has a'), true);
expect('  ...a "<" in a body cannot close the script tag', dash.includes('<script> in it'), false);
expect('  ...the embedded data is valid JSON', (() => { try { return JSON.parse(dash.slice(dash.indexOf('=') + 1, dash.lastIndexOf(';'))).documents.length; } catch { return -1; } })(), 1);
expect('  ...--check now covers the dashboard too', build('--check').code, 0);
writeFileSync(join(WORK, 'gotchas', 'first.md'), doc(GOOD, '# Title\n\nA different body.\n'));
r = build('--check');
expect('  ...a body change makes the dashboard stale', r.code === 1 && r.err.includes('STALE: dashboard.html'), true);

library({ 'gotchas/first.md': doc(GOOD), 'tools/dashboard-template.html': '<p>no placeholder</p>\n' });
r = build();
expect('a template without the placeholder: rejected', r.code === 1 && r.err.includes('missing /*__LIBRARY_DATA__*/'), true);

rmSync(WORK, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
