# Evaluation checklist

Fill this for every candidate, in this order, into `eval/review.md`. One line per item:
`PASS`, `FIX <op>` or `REGEN <reason>`. Silhouette problems are REGEN; everything a
script can do is FIX. Do not rationalize a shape problem into a fix.

Read `sheet.png` first. Layout: row 1 textured front/right/back/left, row 2 clay (single
color + cavity) of the same views, row 3 head close-up. The clay row is the honest one:
textures hide dents, merged fingers and lumpy faces; cavity shading shows them.

## A. Silhouette and proportions (vs reference) — REGEN territory
- [ ] Overall proportions match the reference (head:body ratio, limb length, shoulder width)
- [ ] Both arms and both legs are separate, full length, not merged with torso or each other
- [ ] Hands read as hands in the clay front view (fingers or a clean mitt, no claw blobs)
- [ ] Feet are flat and symmetric; no missing sole, no fused shoes
- [ ] Pose is the requested A/T pose; arms clear the torso for rigging
- [ ] Back view is plausible (hood, hair, belt): note "generator-inferred" if there was no back reference

## B. Must-have features (from spec.must_have) — REGEN if missing, FIX if present but damaged
For each feature: present? recognizable from 1 m? damaged (floating, warped, fused)?
Use the head close-up for anything on the face (glasses, hat brim, hair).

## C. Geometry health (from stats.json) — FIX territory
- [ ] `triangles` within 5 % of `triangle_budget` → else `decimate_to`
- [ ] `islands_total` == number of intentional parts; small islands → `remove_loose_parts`
      (anything with `smallest_island_ratio_to_height` < 0.01 is a crumb)
- [ ] `non_manifold_edges` low (a few hundred on a 15k mesh is normal for AI output; thousands is REGEN)
- [ ] `loose_vertices` == 0 → else `merge_by_distance`
- [ ] `feet_on_ground` and `centered_xy` true → else `set_origin_feet`
- [ ] `height_m` within 2 % of spec → else `scale_to_height`
- [ ] every object has UVs, `fraction_inside_0_1` > 0.98
- [ ] materials count small (one or two); names will be fixed by `rename`

## D. Texture (textured row + head close-up)
- [ ] Colors match the reference palette (a yellow raincoat is not orange)
- [ ] No baked-in lighting or shadows (dark armpits, bright highlight on the hat)
- [ ] No text-like smears or duplicated features (second mouth on the back of the head)
- [ ] Seams not visible at viewing distance
If the color/material is wrong but the shape is right: REGEN is cheaper than it looks only
when it is one material; otherwise a `texture_prompt` on the next generation is the fix.

## E. Rig readiness (before sending to rigging)
- [ ] Clear biped silhouette in the clay front view
- [ ] Arms away from the body (a-pose or t-pose), legs apart
- [ ] No props that read as limbs (a staff along the arm, a cape over the arms)
Meshy returns 422 when it cannot estimate the pose; that means REGEN, not retry.

## F. After rigging (final sheet on the exported FBX)
- [ ] `armatures` == 1, `bones` > 0 in stats.json
- [ ] Mesh still matches the pre-rig sheet (rigging does not change shape)
- [ ] Walking/running clips downloaded (`rigged/walking*.fbx`, `rigged/running*.fbx`)

## Scoring the decision
- Any A or E failure → REGEN with one specific change (see SKILL.md step 2).
- B missing → REGEN; B damaged → FIX (custom_script) or accept and report.
- C, D → FIX plan, then re-evaluate before rigging.
- Stop after 3 generations or 2 fix passes on the same defect; report and ask (BLOCKING).
