# Budgets and provider notes

Defaults for a stylized UE5 game on PC; mark every number taken from here as "budgets.md
default" in the brief. They are starting points from common practice, not measurements of
this project. Lower them for mobile and raise them for a cinematic hero if the user says so.

## Character tiers (LOD0, triangles / base colour texture per material)

| Tier | Camera | Triangles | Texture | Materials | Notes |
|---|---|---|---|---|---|
| Hero (playable, close-ups) | third person, cutscenes | 30 000–60 000 | 4K body, 2K parts | 2–4 | quad topology for the base, PBR maps, facial rig if dialogue |
| Companion / key NPC | third person | 15 000–25 000 | 2K | 1–2 | triangle remesh fine; walk/run/idle + talk |
| Generic NPC | third person, mid distance | 8 000–15 000 | 2K | 1 | walk/run/idle; no facial |
| Crowd / background | far, many on screen | 2 000–6 000 | 1K | 1 | one material, share the skeleton, no parts |
| Enemy (combat) | third person | 12 000–25 000 | 2K | 1–2 | hit reactions, death; budget by count on screen |
| Creature / quadruped | varies | 10 000–30 000 | 2K | 1–2 | Meshy rig is bipeds only; quadruped needs Tripo rig or manual |

Parts inside those totals: glasses 500–1 500, hat 1 000–2 500, cords/straps 300–1 200,
backpack 1 500–4 000. A part budget is its own line in `spec.parts[].triangle_budget`.

Platform multipliers: PC/console ×1; Switch-class ×0.5; mobile ×0.3 with 1K textures.

LODs: UE5's built-in reduction handles LOD1–3 from LOD0 for stylized characters; plan
LOD0 only unless the user runs Nanite skeletal meshes (then ask, it changes the budget).

## Camera distance → texture

| Closest the camera gets | Base colour |
|---|---|
| face fills the screen (cutscene) | 4K |
| full body at 2–3 m | 2K |
| never closer than 5 m | 1K |

## Props (not characters)

| Prop size | Triangles | Texture |
|---|---|---|
| hand-held (weapon, tool) | 1 500–6 000 | 2K |
| furniture-scale | 2 000–10 000 | 2K |
| set dressing, many copies | 200–2 000 | 1K atlas |

## Generator notes (for the provider question)

From a three-way test of these providers on one reference: all three painted skin
inside glasses lenses and fused hood cords; that is structural, hence modular parts.

| Provider | Strength | Rig | Cost model | Status in the driver |
|---|---|---|---|---|
| Meshy | full pipeline in one API: multi-image, remesh (quad), rig, animations, retexture, text-to-image with multi-view | yes, humanoid, 5 credits, rigs any textured GLB | credits per generation (30 textured), monthly plan | implemented |
| Tripo | fastest; cheapest plan; part splitting; rigging incl. quadrupeds; most community-recommended | yes | credits, from ~US$20/mo | not implemented |
| Rodin (Hyper3D) | best geometry detail in that test (folds, cuffs, laces); part splitting; official hosted MCP | no | free to generate, pay to download (regen loops cost nothing until a pick) | not implemented |

Default recommendation: base from whichever the user's eyes prefer on the same reference,
rig with Meshy (it accepts any GLB), parts procedural where possible. Meshy is the default
only because its backend exists; switch when Tripo/Rodin backends are built.

Credits for a first run (Meshy): base 30 (+5 ultra), rig 5, each Meshy part 15–30,
regenerations ×30. A 3-generation budget with one Meshy part is roughly 125 credits.
