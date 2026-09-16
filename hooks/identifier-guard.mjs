#!/usr/bin/env node
/**
 * PostToolUse guard: flag freshly written identifiers that are commonly invented
 * rather than looked up.
 *
 * Why this exists. Across one week of transcripts the single most frequent real
 * defect was a plausible-looking name or number that was never checked against a
 * real list — roughly ninety instances. The expensive ones were silent:
 *
 *   - a guessed Bikers-DLC stalk model killed the planting thread instantly and
 *     left the `planting` flag stuck, so every later attempt died with no error;
 *   - `bkr_prop_weed_drying_01a`, admitted afterwards as "a prop I never
 *     confirmed in-game";
 *   - dart, watering-can, oven and chalk rotations estimated rather than derived,
 *     costing roughly thirteen rounds of the user's in-game testing. One was
 *     finally solved by the user himself: "regador 0 180 180 did the trick".
 *
 * The model tier does not cause this — Opus wrote most of them. It is a
 * verification failure, and it is invisible in review because a guessed
 * identifier looks exactly like a correct one. The only moment it is cheap to
 * catch is the moment it is written. So this fires then.
 *
 * ADVISORY ONLY. PostToolUse cannot undo the edit and this must never pretend
 * to. It names what was just written and asks where it came from.
 *
 * Scope is deliberately narrow: identifier families whose real list is knowable
 * and whose failure mode is silent. A pattern that fires on correct code more
 * often than on invented code is worse than no pattern, so add carefully.
 */

const PATTERNS = [
  {
    // GTA/FiveM model, ped and object names. Real source: the game's own asset
    // list (DurtyFree object lists, gtahash, an in-game check) — never memory.
    name: 'GTA/FiveM asset name',
    exts: ['.lua'],
    re: /(["'])((?:prop_|p_|v_|ba_prop_|bkr_prop_|xm_prop_|xm3_prop_|hei_prop_|ex_prop_|apa_prop_|gr_prop_|sf_prop_|sm_prop_|vw_prop_|ch_prop_|h4_prop_|reh_prop_|tr_prop_|w_|a_m_[a-z]_|a_f_[a-z]_|s_m_[a-z]_|s_f_[a-z]_|u_m_[a-z]_|u_f_[a-z]_|g_m_[a-z]_|ig_|csb_|cs_|mp_[a-z]_)[a-z0-9_]{3,})\1/gi,
    how: 'confirm each against a real object list or spawn it in-game once',
  },
  {
    // A wrong coordinate or heading is not a crash, it is a prop in a wall — and
    // the user is the only one who can see it. That makes it his test round.
    name: 'world coordinate / heading literal',
    exts: ['.lua'],
    re: /\bvect(?:or)?[34]\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)?\s*\)/gi,
    how: 'say where each number came from — measured in-game, copied from an existing entity, or computed',
  },
  {
    // SetEntityRotation / AttachEntityToEntity triples. Four fix rounds on a dart
    // and three on a watering can came from estimating these.
    name: 'rotation / attachment offset triple',
    exts: ['.lua'],
    re: /\b(?:SetEntityRotation|SetEntityHeading|AttachEntityToEntity|PlaceObjectOnGroundProperly|SetEntityCoordsNoOffset)\s*\(/g,
    how: 'a rotation must be measured or derived; estimating it turns the user into the test loop',
  },
];

const contentOf = (tool, input) => {
  if (!input) return '';
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : '';
  if (tool === 'Edit') return typeof input.new_string === 'string' ? input.new_string : '';
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.map((e) => e?.new_string ?? '').join('\n');
  }
  return '';
};

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // never interfere on a payload we cannot read
  }

  const tool = payload?.tool_name ?? '';
  const input = payload?.tool_input ?? {};
  const path = typeof input.file_path === 'string' ? input.file_path : '';
  if (!path) process.exit(0);

  // Only the text that was just introduced, not the whole file. Re-flagging
  // identifiers that were verified weeks ago is exactly the noise that gets a
  // guard ignored.
  const added = contentOf(tool, input);
  if (!added) process.exit(0);

  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const findings = [];

  for (const p of PATTERNS) {
    if (!p.exts.includes(ext)) continue;
    const hits = [...new Set((added.match(p.re) ?? []).map((m) => m.trim()))];
    if (hits.length) findings.push({ p, hits });
  }

  if (!findings.length) process.exit(0);

  const lines = findings.map(({ p, hits }) => {
    const shown = hits.slice(0, 6).join(', ');
    const more = hits.length > 6 ? ` (+${hits.length - 6} more)` : '';
    return `  - ${p.name}: ${shown}${more}\n    → ${p.how}`;
  });

  const msg =
    `Identifier check on ${path}\n` +
    lines.join('\n') +
    `\n\nEach of these must have been read out of a real list, file or measurement. ` +
    `If any was produced from memory or because it looked right, say so now and verify it — ` +
    `a guessed asset name fails silently at runtime and a guessed coordinate is only visible to the user, ` +
    `which turns him into the test loop. If they were all looked up, ignore this.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg },
    }),
  );
  process.exit(0);
});
