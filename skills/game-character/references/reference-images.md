# Reference image contract

The generator paints the mesh by projecting the reference onto it. Everything in the image
ends up on the model: lighting, shadows, background colour bleeding at the silhouette, and
every accessory. So the reference is a spec, not a mood board. Intake checks it before any
credits are spent; a reference that breaks a hard rule is sent back with the rule named.

## Hard rules (Intake refuses on these)
- Accessories that are parts in `spec.parts` are NOT in the base reference. No glasses, no
  cords, no hat if the hat is a part. A plain neckline. The model can't un-see them, and the
  texture prompt only reduces the damage.
- A-pose: arms away from the torso at roughly 30–45°, palms down or relaxed, legs slightly
  apart, feet flat and visible. Crossed arms, hands in pockets, or a staff along the body
  make rigging fail (Meshy returns 422).
- Full body in frame, nothing cropped, including the soles.
- Single subject. No props on the floor, no companions, no text.

## Strong rules (Intake warns, proceeds if the user says so)
- Flat, even light. No rim light, no dramatic key, no cast shadow under the chin or in the
  armpits. Overcast-day lighting. A baked highlight on a hat becomes a permanent bright
  patch that moves wrong under game lighting.
- Plain light background (white or light grey), high contrast with the character's outline.
- Character fills about 80–90 % of the frame height.
- Front view at exactly 0°, eyes level with the camera, no perspective distortion (a long
  lens look). For multi-view: the same character at 90° (side) and 180° (back) in the same
  pose, light and framing; the front image goes first in `references`.
- PNG, portrait or square, longest side ≥ 1024 px, ≤ 20 MB.

## Per-part references (only for parts with source: meshy)
- The item alone on a white background, at the angle it is seen most in game (a hat from
  the front-three-quarter, a backpack from the back).
- Hollow or open where a body goes through it, and say so in the part's `texture_prompt`
  ("hollow, no head inside").

## Automatic check
`blender -b --python scripts/check_reference.py -- --image ref/front.png [--json out.json]`
measures size, background flatness at the border, subject fill ratio and rough aspect, and
prints PASS/WARN/FAIL per rule. Pose and accessories are judged by Claude with `Read`.

## What the brief for the image tool should say (copy into the image tool's prompt)
"Full-body character turnaround for 3D generation. [description of the character, without
the parts]. A-pose, arms 40° from the body, legs slightly apart, feet flat. Front view, eye
level, orthographic look. Flat even studio lighting, no shadows, no rim light. Plain white
background. Character fills 85 % of the frame. No glasses, no hat, no hood cords, plain
neckline. PNG, 1024×1536." Then the same text with "side view at 90°" and "back view at
180°", keeping every other word identical so the model keeps the character consistent.
