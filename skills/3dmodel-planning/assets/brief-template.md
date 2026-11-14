# <Name> — model brief

Slug `<slug>` · Tier <hero/npc/...> · Camera <third-person> · Platform <PC, UE 5.5>
Status: draft / approved by <user> on <date>

## Identity
One paragraph: who this is in the game and what the player should recognise at a glance.
Three identity features (become `must_have`):
1. <feature>
2. <feature>
3. <feature>

## Reference
- Status: have it / will generate / described below
- Views: front only / front + side + back
- Files: `characters/<slug>/ref/front.png` (+ side.png, back.png)
- Exclusions in the base reference: <every part listed below>

## Modular breakdown
| Element | Where it comes from | Attach | Landmark | Budget (tris) | Why |
|---|---|---|---|---|---|
| body + raincoat + trousers + boots | base (generator) | rig | — | 15 000 | organic, fused clothing |
| glasses | procedural `glasses` | rigid | eyes | 1 500 | generator paints skin in the lens |
| drawstrings | procedural `drawstrings` | deform | chest | 1 200 | must hang free |
| bucket hat | Meshy part | deform | head_top | 2 000 | soft fabric, swappable skin |

Swappable for skins: <list>. Fused for good: <list>.
Needs a generator that does not exist yet: <name, with measurements in meters> / none.

## Motion
- Rig: Meshy humanoid → IK Retarget to Manny
- Clips at delivery: walk, run (free with rig); <idle: library action id or "later">
- Dangly: <drawstrings deform-weighted; physics bones later>
- Facial: none / required

## Budgets
| Item | Value | Source |
|---|---|---|
| base triangles | 15 000 | budgets.md NPC tier |
| texture | 2K | camera at 2–3 m |
| parts total | 4 700 | sum of parts |
| height | 1.75 m | user |

## Provider and cost
- Base: <meshy | tripo | rodin> because <reason>. Rig: Meshy.
- First-run estimate: <n> credits (base 30, rig 5, parts …). Loop budget: 3 generations.

## Assumed (defaults the user did not state)
- <assumption> → <default used>

## Open
- <anything the user still has to decide, marked BLOCKING or FYI>

## Handoff
Generate the references from `reference-brief.md`, drop them in `characters/<slug>/ref/`,
then run `game-character` with: "Build <Name> from characters/<slug>/spec.json".
