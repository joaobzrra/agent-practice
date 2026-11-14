---
name: 3dmodel-planning
description: "Use only when the user names this skill: \"use 3dmodel-planning\", \"plan this model with the planning skill\", \"/3dmodel-planning\". Pins down a game 3D asset (character, NPC, enemy, creature, prop, weapon, environment piece) before anything is generated: an interview in batched choices, then brief.md, spec.json for the game-character skill, and reference-brief.md with the prompt text for the user's image tool. Runs before game-character; spends no credits."
---

# 3D model planning

The generation pipeline is cheap to run and expensive to re-run: every wrong assumption
costs credits and an hour. This skill moves the thinking to before the first credit. It is
a conversation with a deliverable, not a form: ask in batches of structured choices (easier
to answer than open questions), always with a recommendation and the reason, and never a stack of
open-ended questions.

Output, under `characters/<slug>/` (or `props/<slug>/`):
- `brief.md` — the human-readable plan (template in `assets/brief-template.md`)
- `spec.json` — the machine spec, in the `game-character` skill's `references/spec-template.json` shape
- `reference-brief.md` — the prompt text for the user's image tool, one block per view and per part

Done means: the user has approved `brief.md`, `spec.json` validates against the template's
fields, and `reference-brief.md` exists. The user then generates the references (in their
own image tool; that part needs their eye) and hands the folder to `game-character`.

## 1. Read what is already there

Before asking anything, read the project's `CLAUDE.md`, any art bible or style doc, the
existing `characters/` folders (budgets and naming already in use), and any image the user
attached. Questions whose answers are in the repo waste the user's time; say what you found
and ask only about the gaps.

## 2. Interview, in batches

Use `AskUserQuestion` with 2–4 questions per batch, each with a recommended option first.
Mark every question BLOCKING or FYI. `references/question-bank.md` has the full bank with
the reason behind each question; pick the ones the repo did not answer. Typical order:

**Batch A, identity (BLOCKING):** what it is (hero / companion / NPC / crowd / enemy /
creature / prop), where the camera sits (third-person close, isometric, first-person hands
only), target platform and UE version. These three decide every budget.

**Batch B, look:** style (stylized / painterly / realistic), what the reference will be
(user has one, user will generate one, Claude describes it for the user's tool), the three
identity features that must read at gameplay distance. Hair treatment (cards / sculpted /
part of the mesh) is decided here because generators handle it worst.

**Batch C, modularity (BLOCKING for anything beyond a one-off):** which pieces swap for
skins or variants, which are fused. Apply the sourcing rule from `game-character`: organic
→ generator, hard-surface → procedural, dangly → procedural with deform weights, existing →
library. List every visible element and sort it; the user confirms the sort.

**Batch D, motion:** locomotion only / combat / facial / cloth. Rig target (Manny retarget,
custom), which clips come free (Meshy gives walk and run), which must be bought or authored.
Drawstrings and cloth get their own line, because they decide whether a piece needs bones.

**Batch E, budget and provider:** triangle and texture budgets from
`references/budgets.md` for the tier and camera distance, adjusted for the platform. Which
generator for the base (meshy / tripo / rodin, see the provider notes in that file) and
which for Meshy-type parts. Credits estimate for the first run, with the loop budget.

Stop asking when a wrong guess no longer costs anything. Fill the rest with defaults and
list them under "Assumed" in the brief.

## 3. Write the three files

`brief.md`: fill the template. Every budget line names where the number came from
(user / budgets.md tier / assumed). The modular table lists each piece with source, attach
mode and landmark, so `spec.json` is a direct transcription.

`spec.json`: copy the game-character template, fill from the brief, delete nothing the
template has. Parts that are `procedural` need a generator that exists in
`game-character/scripts/build_part.py` (`glasses`, `drawstrings` today); a part that needs a
new generator is marked `"source": "procedural", "generator": "TODO:<name>"` and listed in
the brief under "Needs a generator", with the measurements Claude would need (dimensions in
meters, read off the reference).

`reference-brief.md`: use the contract in `game-character/references/reference-images.md`.
One block for the base front view, one each for side and back if multi-view is wanted
(identical wording except the angle), one per Meshy-sourced part on a white background.
Every block repeats the "no <part>" exclusions, because the image model forgets them
between calls. Write it in the language the user's image tool works best in.

## 4. Review with the user

Show `brief.md` inline (it is short), ask for the one thing that only they can judge
(usually the modular sort and the three identity features), and apply the correction. Do
not start generating anything; this skill ends with the handoff line:
"Generate the references from reference-brief.md, drop them in `characters/<slug>/ref/`,
then run game-character."

## Guardrails

- Numbers come from `budgets.md` or the user, never invented. If a tier is not in the
  table, say so and ask.
- A piece the user calls "part of the character" is still sorted by the rule; explain why
  the glasses cannot stay in the base (the generator paints skin inside the lens) before
  accepting a fused choice. If they still want it fused, record it as their decision.
- One slug per model; a variant/skin is a parts change on the same slug, not a new one.
- No em-dashes in anything the user will paste into another tool.
