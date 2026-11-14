---
name: game-character
description: "Use only when the user names this skill: \"use game-character\", \"run the character pipeline\", \"/game-character\", or when resuming a run that already has a characters/<slug>/run.json. Turns a character reference (concept image plus technical notes) into a modular, rigged, UE5-ready character: Meshy base mesh, hard-surface accessories built procedurally in Blender, parts skinned onto one skeleton, evaluated against the reference, exported as skeletal/static meshes with a report. Spends Meshy credits. Not for general 3D, Blender or Unreal questions."
---

# Game character pipeline

One request in ("we need a character like this reference, 15k tris, for UE5"), one folder out:
a base skeletal mesh, one file per part sharing that skeleton, a contact sheet, and a report that
says what was verified and what still needs a human.

Claude is the art director and pipeline operator, not the modeler. The split that makes this
work:

| Piece | Source | Why |
|---|---|---|
| Organic: body with its fused clothing, hair, a soft hat | **Meshy** | the only thing generators do well |
| Hard-surface accessory: glasses, buttons, watch, belt buckle | **bpy generator** (`scripts/build_part.py`) | a rim is a torus; code gives exact topology and colour for zero credits. Generators paint a skin-coloured lens because they project the reference |
| Dangly / simulated: drawstrings, straps, hood ties | **bpy generator**, deform-weighted | needs its own geometry to move at all; fused cords never swing |
| Something the project already owns | **library** GLB | reuse beats regenerate |

Blender Python cannot produce organic character geometry. If you catch yourself writing bpy that
sculpts a body part, stop: that is a regenerate decision, not a fix. Hard-surface code is the
exception, and it is the better tool there.

## Stages

```
0 Intake     → spec.json: base + parts, acceptance criteria, agreed before credits are spent
1 Generate   → Meshy image-to-3D (or multi-image) → candidates/cN/raw.glb          [base]
2 Evaluate   → headless Blender: stats.json + contact sheet → Claude judges vs reference
3 Adjust     → fix plan → prepped/prepped.glb   (or: regenerate, back to 1)
4 Rig        → Meshy rigging on prepped.glb → rigged/character.glb (+ walk/run clips)
5 Parts      → build_part.py (procedural) / generate --part (meshy) / library → parts/<name>/raw.glb
6 Assemble   → landmarks, placement, weight transfer, modular export → export/
7 Present    → final sheet on assembled_preview.glb, report.md
```

Everything lands in `characters/<slug>/`. `run.json` is the manifest (every Meshy task id,
file, decision); resume from it, never recreate a Meshy task because a poll timed out.
Stages 5 and 1–4 are independent: build procedural parts while the base generates.

## 0. Intake

If a `characters/<slug>/brief.md` and `spec.json` already exist (written by the
`3dmodel-planning` skill), read them and skip to the reference check; the planning
conversation already made the decisions below. If not, make them here.

`Read` the reference(s). Write `characters/<slug>/spec.json` from `references/spec-template.json`.
Fill what the user gave; keep the template defaults for the rest and say so in one line.

Then check the reference against `references/reference-images.md` before spending anything:
```
"%BLENDER_EXE%" -b --python scripts/check_reference.py -- --image <front.png> --json <front.check.json>
```
covers size, background, fill and cropping; `Read` the image yourself for pose and for
accessories that are listed as parts. A FAIL, or a part visible in the base reference, stops
the run: say which rule, and hand the user the brief text from that file for their image
tool. The user generates references themselves (in their own image tool) and validates
them; this skill does not generate reference images.

The modular decision happens here. Walk the reference and sort every visible element into
the table above. Anything that becomes a part gets:
- its own entry in `parts[]` (`source`, generator or references, `attach`, `triangle_budget`)
- a line in the base `texture_prompt` telling Meshy to leave it off ("no glasses, no hat,
  plain neckline"), so the base does not carry a fused copy
- removal from the base `must_have` list (it is checked on the part instead)

Ask one question only when a wrong guess costs real credits or UE rework: hero vs background
budget, a reference that is not a humanoid (rigging returns 422), or whether a clothing item
is a swappable part or fused into the base (hoodie vs jacket over hoodie). Otherwise decide,
state the assumption, proceed.

Cost line for the user before the first call: base generation 30 credits (+5 ultra), rigging 5,
each Meshy part 15–30. Procedural parts are free. Default loop budget: 3 base generations.

## 1. Generate (base)

```
python scripts/meshy_pipeline.py generate --spec characters/<slug>/spec.json --out characters/<slug>
```

One reference → image-to-3D; two to four → multi-image, front first. Parameters come from
`spec.generation` (`latest` = Meshy 7.1, textured, PBR, A-pose, remesh to `triangle_budget`).
Full parameter table in `references/meshy-api.md`; never invent one. Needs `MESHY_API_KEY`
in the environment (never in a file, never printed) and `BLENDER_EXE` for the next stage.
Run `meshy_pipeline.py balance` once per run and put the number in the report.

## 2. Evaluate

```
"%BLENDER_EXE%" -b --python scripts/blender_evaluate.py -- --input <model> --out <dir> --spec characters/<slug>/spec.json
```

Produces `stats.json` (triangles, height, feet height and horizontal centre, islands, non-manifold edges, UVs, armature,
bones) and `sheet.png`: row 1 textured front/right/back/left, row 2 the same views in clay
(single colour + cavity, which shows what textures hide), row 3 head close-up.

`Read` the sheet next to the reference and fill `references/evaluation-checklist.md` into
`eval/review.md`, one line per item: PASS, FIX <op>, or REGEN <reason>. Silhouette first,
then must-haves, then texture, then rig-readiness.

- Any REGEN → back to Generate with **one** specific change (side/back reference,
  `image_enhancement: false` when Meshy restyled it, a `texture_prompt`, the other pose).
  Record the change in `run.json`. After 3 generations stop and ask which candidate to keep
  (BLOCKING), with the sheets side by side.
- Only FIX → Adjust.  All PASS → Adjust anyway (the standard prep always runs).

Shape problems are REGEN (proportions, merged limb, wrong back, lumpy face in the clay row).
Script-fixable problems are FIX (crumbs, scale, origin, over-budget, naming). A fused
accessory that should have been a part is neither: add it to `parts[]`, add the "no X" line
to the base `texture_prompt`, regenerate once.

## 3. Adjust

Write `candidates/cN/fix_plan.json` and run:

```
"%BLENDER_EXE%" -b --python scripts/blender_fix.py -- --input <raw.glb> --plan <fix_plan.json> --out characters/<slug>/prepped
```

Known ops (arguments in the script header): `remove_loose_parts`, `merge_by_distance`,
`recalc_normals`, `decimate_to`, `smooth_shading`, `join_objects`, `set_origin_feet`,
`scale_to_height`, `rename`, `pack_textures`, `custom_script` (a small bpy file kept next to
the plan). Re-run Evaluate on `prepped/prepped.glb` and confirm every FIX reads PASS before
rigging. Topology changes happen here on purpose: the script refuses them on a rigged file,
because weights on a mesh you later decimate are how a character ships broken.

## 4. Rig

```
python scripts/meshy_pipeline.py rig --spec characters/<slug>/spec.json --out characters/<slug> --model characters/<slug>/prepped/prepped.glb
```

Pass `--from-task` instead when Adjust changed nothing. Downloads `rigged/character.glb|fbx`
and the walking/running clips. `422` = Meshy could not read a biped: REGEN with
`pose_mode: t-pose` or a cleaner reference, not a retry.

## 5. Parts

Run these while the base is generating; they do not depend on it.

Procedural (`glasses`, `drawstrings` ship; add a `gen_<name>` function for a new one):
```
"%BLENDER_EXE%" -b --python scripts/build_part.py -- --generator glasses --params characters/<slug>/parts/glasses/params.json --out characters/<slug>/parts/glasses/raw.glb
```
Every generator builds in meters, facing -Y, origin at the attach point, materials named
`M_<generator>_*`. Writing a new generator: measure the proportions off the reference (lens
radius ≈ 0.02 m on an adult head, pupil distance ≈ 0.064 m), parametrize them, keep the
triangle count under the part budget, and `Read` a render before accepting it.

Meshy (a hat, a bag, hair): a cropped reference of the item alone, `texture_prompt` saying
"hollow, no head inside" for anything worn, small budget:
```
python scripts/meshy_pipeline.py generate --spec characters/<slug>/spec.json --out characters/<slug> --part bucket_hat
```
Evaluate a Meshy part like the base (clay row matters more: thin brims and open rims are
where it fails). Library: set `file` in the part entry.

## 6. Assemble

```
"%BLENDER_EXE%" -b --python scripts/blender_assemble.py -- --base characters/<slug>/rigged/character.glb --spec characters/<slug>/spec.json --parts-dir characters/<slug>/parts --out characters/<slug>/export
```

What it does, so the output can be judged:
1. Joins the base meshes into `SK_<Name>`, names materials `M_<Name>_*`, keeps the armature
   named `Armature` (UE's importer then does not add an extra root bone).
2. Computes landmarks (`eyes`, `chest`, `head_top`, `neck`, `waist`): z from the head/neck/
   spine bones when Meshy's names match, else height fractions; y by ray-casting the base
   surface from the front. Written to `export/landmarks.json`. Run with `--landmarks-only`
   first, read the numbers, sanity-check them against the clay front render (eyes at the
   eyes, chest at the neckline). Override per part with `attach.position_m` if a landmark
   is off; do not nudge the generator.
3. Places each part at landmark + `attach.offset_m`, then skins it: `rigid` → every vertex
   100 % to the landmark's bone (glasses on the head bone); `deform` → weights copied from
   the nearest base surface (Data Transfer, nearest-face interpolated), cleaned and
   normalized. Both get an Armature modifier on the same skeleton.
4. Exports, when `spec.export.modular` is true (the default):
   - `SK_<Name>.fbx` base
   - `SK_<Name>_<part>.fbx` per part, skeletal, same skeleton (UE: leader pose component)
   - `SM_<Name>_<part>.fbx` per rigid part as a static mesh, plus `sockets.json`
   - `assembled_preview.glb` for the final sheet, `assembly_log.json` with per-part weighted
     fraction, bone, triangles, and warnings
   `modular: false` joins everything into one `SK_<Name>.fbx`.

Read `assembly_log.json`. `weighted_fraction` below 0.999 on a deform part means vertices far
from the base got no weight: move the part closer or raise `offset_m` toward the body.
Then run Evaluate on `assembled_preview.glb` (`--out export/eval`) for the final sheet and
`Read` it: parts in place, nothing floating, nothing intersecting the face.

## 7. Present

Write `characters/<slug>/report.md` with this template, send the final sheet and the FBX
files, reply with a short "Waiting on you / Done / Next" block (the reporting format in this repo's `AGENTS.md`). The person judges by looking, so
the sheet comes first and the prose stays short.

```
# <Name> — character report
Credits used: <n> (balance before / after)

## Waiting on you
- Import export/*.fbx into UE5 (references/ue5-import.md: base first, parts onto the same
  skeleton, leader pose) and confirm height ≈ <h> cm and the glasses sit on the face in the
  walking clip.
- <judgement calls Claude could not make: back accuracy, face likeness>

## Result vs spec
| Item | Spec | Result | How verified |
| base triangles | 15000 | 14 812 | stats.json |
| height | 1.75 m | 1.75 m | stats.json |
| part glasses | rigid, head | 1 420 tris, weighted 1.0 | assembly_log.json |
| part drawstrings | deform, chest | 980 tris, weighted 1.0 | assembly_log.json |
| must-have: raincoat hood | yes | PASS | sheet.png front |

## Generations
c1: <what was wrong> → c2: <what changed> → chosen: c2

## Fixes applied
remove_loose_parts(0.01) — removed 2 islands (cuff fragment, hood tip)

## Known limitations
- Back of the raincoat is generator-inferred (front reference only).
- Rig is Meshy's humanoid; retarget to Manny via IK Retargeter before using Manny animations.
- Drawstrings are skinned to the chest; physics bones are not set up (a later step).

## Files
export/SK_<Name>.fbx, export/SK_<Name>_<part>.fbx…, export/SM_<Name>_<part>.fbx, export/sockets.json,
rigged/walking*.fbx, rigged/running*.fbx, export/eval/sheet.png
```

Label every non-obvious claim Verified (script output you read), Inferred (read off a
render), or Assumed. Triangle counts and height always come from `stats.json` /
`assembly_log.json`, never from request parameters.

## Guardrails

- API key: environment only. Never in a file, commit, log line or reply.
- Never invent a Meshy parameter, a bone name, or a landmark position. Bone names come from
  `stats.json` / `landmarks.json`; a rigid part that cannot resolve a bone stops with the list.
- One change per loop: one input between generations, one plan entry between fix passes,
  one `offset_m` between assembles.
- Two failed attempts at the same defect → stop, say what you now believe is wrong, then act.
- Write only under `characters/<slug>/`; the user's references stay untouched.
- Windows shell: every long input goes through a JSON file (spec, plan, params), never a
  quoted command string. Commands handed to the user are one line each.

## Setup (first run on a machine)

1. `BLENDER_EXE`: find the installed binary (Windows: `Get-ChildItem "C:\Program Files\Blender Foundation" -Recurse -Filter blender.exe`;
   macOS: `/Applications/Blender.app/Contents/MacOS/Blender`; Linux: `command -v blender`)
   and set the env var to that exact path (4.2 or newer). Do not guess a version.
   The commands below use Windows `"%BLENDER_EXE%"`; on macOS/Linux write `"$BLENDER_EXE"`.
2. `MESHY_API_KEY`: the user sets it in their shell. The official Meshy MCP server may also
   be installed; this skill still drives the REST script because the manifest and resume
   logic live there. The MCP is fine for ad-hoc checks (`meshy_check_balance`).
3. Smoke tests, one line each, no credits spent. `--python-exit-code 1` makes a failed
   assert exit non-zero; without it Blender exits 0 even when the script crashed:
   - `python scripts/meshy_pipeline.py balance`
   - `python scripts/meshy_pipeline.py selftest` (generation parameters per `model_type`, offline)
   - `"%BLENDER_EXE%" -b --python-exit-code 1 --python scripts/blender_evaluate.py -- --selftest`
   - `"%BLENDER_EXE%" -b --python-exit-code 1 --python scripts/blender_fix.py -- --selftest`
     (a body with many UV shells plus a crumb: only the crumb may be removed)
   - `"%BLENDER_EXE%" -b --python-exit-code 1 --python scripts/blender_assemble.py -- --selftest`
     (builds a stand-in biped, both procedural parts, assembles and exports them)
