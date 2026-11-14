# Question bank

Each entry: the question, why it matters (what breaks if guessed wrong), the default if the
user does not care, and whether it is BLOCKING. Ask only the ones the repo did not answer.

## A. Identity
- **What is it?** hero / companion / NPC / crowd / enemy / creature / prop. Sets the tier
  and every budget. BLOCKING. No default.
- **Where does the camera sit?** third-person close / isometric / top-down / first-person.
  Sets texture resolution and whether the face needs detail. BLOCKING. Default: third-person.
- **Platform and UE version.** PC / console / mobile; UE 5.4+ changes the retarget flow.
  FYI. Default: PC, UE 5.5.
- **How many on screen at once?** For NPC/enemy/crowd: drives the budget harder than the
  tier. FYI. Default: 1–3.

## B. Look
- **Style.** stylized (Pixar-like) / painterly / realistic. Generators do stylized best;
  realistic humans need Rodin and still look uncanny at close range. FYI. Default: stylized.
- **Reference status.** user has one / user will generate one / none. Decides whether
  reference-brief.md is the main deliverable. BLOCKING.
- **Three identity features.** The things that must read at gameplay distance (bucket
  hat, round glasses, yellow raincoat). These become `must_have` and the evaluation
  checklist items. BLOCKING. No default.
- **Hair.** part of the mesh (fused, cheapest) / separate part / cards later. Generators
  often paint skin into hair roots and fuse hair to hats. FYI. Default: fused in the base,
  hat as a part if present.
- **Skin and face.** facial close-ups yes/no; eyes as geometry or texture. Decides 4K and
  whether a facial rig is needed. FYI. Default: texture eyes, no facial rig.

## C. Modularity
- **Will this character have skins or variants?** yes/no/later. Yes forces modular export
  and a parts list; "later" still forces it (retrofitting a fused mesh means regenerating).
  BLOCKING.
- **Sort every visible element.** For each: base (organic, generator) / procedural
  (hard-surface or dangly) / Meshy part (organic accessory) / library. Present the sorted
  list and ask for corrections, not for the sort itself. BLOCKING.
- **Which parts are rigid and which deform?** Glasses, watch, buckle rigid (one bone);
  hat, scarf, cords deform. FYI. Default by type.
- **Anything that must swap at runtime?** (helmet on/off, weapon in hand). Needs a socket
  and a static-mesh export. FYI. Default: none.

## D. Motion
- **Animation needs.** locomotion only / combat / facial / cloth. Combat and cloth add
  bones or physics; facial adds a rig the generators do not provide. FYI. Default: locomotion.
- **Rig target.** Manny retarget (use stock UE animations) / custom skeleton. Decides the
  IK Retargeter step. FYI. Default: Manny retarget.
- **Clips wanted at delivery.** walk and run are free with the Meshy rig; idle, talk,
  attack cost 3 credits each from the preset library or come from the project. FYI.
  Default: walk, run.
- **Dangly pieces.** cords, straps, tails, long hair: physics bones (a later step) or
  deform-weighted to the body (works now). FYI. Default: deform-weighted, note the physics upgrade.

## E. Budget and provider
- **Triangle budget.** From `budgets.md` tier unless the user has a number. FYI with
  recommendation. Default: tier value.
- **Texture resolution.** From camera distance. FYI. Default: tier value.
- **Generator for the base.** meshy / tripo / rodin. Only Meshy has a driver backend; if
  the user prefers another, the brief records it and the backend is built before the run.
  FYI. Default: meshy.
- **Credit ceiling for this model.** Sets `budget.max_generations`. FYI. Default: 3
  generations.
- **Deadline / prototype vs final.** A prototype may accept a fused base with the parts
  listed as "later"; a final does not. FYI. Default: final.

## F. Naming and placement
- **Slug and display name.** `SK_<Name>`, `M_<Name>_*`, folder `characters/<slug>/`.
  FYI. Default: derived from the display name.
- **Where it lives in the UE project.** `Content/Characters/<Name>/`. FYI. Default: that.
