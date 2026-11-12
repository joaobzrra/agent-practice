---
name: ui-refine
description: Use for any front-end work judged by looking at it — building or changing a page, component, panel, modal, layout, spacing, alignment, typography, animation or visual polish, in any project, and game visuals — HUDs, level layout, building placement, meshes, materials. Covers setting a visual target before coding, building locally instead of delegating, and the screenshot-compare-fix loop that has to pass before the user sees it. Also use it when verifying or debugging anything visual — a visual bug report, "it looks wrong", a layout or rendering regression, or confirming a visual fix — alongside systematic debugging, not instead of it. Also use it when the user says "design", "frontend", "UI", "screen", "page", "HUD", "menu" or "make it look better". When building a new screen or app from nothing, this skill requires invoking a design-direction skill too, if you have one.
---

# UI Refine

The goal is that the first version the user sees needs a tweak, not a rewrite.
In the transcripts, UI that landed well was written by the main model and
screenshotted after each change. UI that missed ("It's pretty, but it doesn't
look like what I expect") was delegated to an implementer and checked once.

The main model writes the markup and CSS. Subagents may inventory components or
build the data layer underneath — never the look.

## 0. New from nothing? Invoke a design-direction skill first

If there is no existing screen, component set or tokens file to match — a new
app, a new site, a first HUD — invoke a design-direction skill, if you have one,
before step 1 and produce its design plan (palette, type, layout wireframe,
principles). That plan becomes the target. When refining something that already
exists, skip it: the existing system is the target, and a fresh "distinctive
identity" would fight it.

## 1. Fix the target before writing code

A UI task without a target is a guess. Get one of these, in this order:

1. **A reference the user gave** — a screenshot, a mockup, "like the versions
   panel". Treat it as the spec. Say which properties you will match: alignment
   edges, spacing rhythm, type sizes, colours.
2. **The existing system** — the project's tokens file, the neighbouring
   components, the spacing and radius values already in use. Read them and
   reuse them. A new screen that invents its own spacing scale looks "off" even
   when nothing is broken.
3. **Neither exists** — screenshot the current state, then state the target in
   three to five lines (what aligns to what, the spacing scale, the one thing
   that should stand out) and proceed. Ask only if the direction is a business
   or taste call the user owns; mark it BLOCKING or FYI. If the user has
   opted out of involvement, do not ask: decide, write the target down, and
   judge against it (see "Hands-off mode" below).

Whichever source you used, write these two lines in your reply before any
code, filled in:

> Reading this as: <page kind> for <audience>, with a <vibe> feel, built on
> <the existing system, or the family you chose>.
> Locks: accent <one colour>; radius <one value, or one value per component
> kind>; main action label "<the one label every primary button uses>".

Example: "Reading this as: checkout step of a live store for mobile shoppers,
with a calm, trust-first feel, built on the store's existing buttons and
greens. Locks: accent the store's green; radius 6px; main action label
"Go to payment"." The audience picks the look, not your taste. Every
value on the page then comes from those locks; a value outside them is a
defect to fix in step 3.

If the project has its own design references, use them for critique of a plan
or a screenshot. They advise; you write the code.

**Redesigning something that already exists** (a live store, a live page): the
current page is the target, and these stay byte-identical unless the user
named them:

- URLs and route names.
- Form field `name` and `id` attributes, and field order.
- Element ids, and `data-*` attributes analytics or scripts read
  (`data-gtm`, `id="btn-checkout"`).
- Button, link and nav labels.
- Logo, legal, consent and cookie copy.

Change the look by adding classes and CSS around them, and by restyling in
this order, stopping when the brief is met: type, spacing, colour, then
structure. The report lists each item above that you changed and why; "none"
is a valid answer.

**A marketing, landing or portfolio page**: read
`references/landing-pages.md` (next to this file) before step 2.

## 2. Build the whole thing in one pass

Cover what the user will otherwise report back one round at a time:

- Every state: empty, loading, error, long content, many items, hover, focus,
  disabled.
- Desktop and a phone-width viewport.
- Real copy in the project's language, following the project's own language
  rule, not placeholder text.
- Reuse the existing tokens and components. Add a new value only when none fits,
  and say so.
- One theme (light or dark) for the whole screen; sections do not invert.
  Accent, radius and main action label come from the locks in step 1.
  A circle (`50%`) for an avatar or dot is not a radius violation.
- Animate only `transform` and `opacity`, and switch every animation off under
  `@media (prefers-reduced-motion: reduce)`.
- Full-height sections use `min-height: 100dvh`, not `100vh` or `h-screen`
  (the phone address bar makes those jump).
- Italic display text with a descender (g, j, p, q, y) gets `line-height` of
  at least 1.1 and a little bottom padding, or the tail is clipped.

## 3. Look at it, then measure it

Before reporting, open the real page and take screenshots at desktop width and
phone width. Then check the things the eye misreads:

- **Alignment** — read `getBoundingClientRect()` for the edges that are
  supposed to line up and compare the numbers. "Looks aligned" is not a check.
- **Spacing** — read computed padding and gap for siblings that should match.
  Measure in a separate tool call from any click, or transitions report stale
  values.
- **Overflow** — nothing clipped, no horizontal scroll at phone width.
- **Contrast** — every button label, input text, placeholder, form label and
  focus ring against its real background: 4.5:1 for text, 3:1 for text 18px
  and up. Compute it from the computed colours; a ghost button over a photo
  needs a scrim or a stroke.
- **Buttons** — every call-to-action label fits on one line at desktop width.
  A wrapped label means a shorter label or a wider button.
- **Against the target** — put your screenshot next to the reference and list
  every difference. Fix each one, re-screenshot, repeat.

Two rounds of self-fix on the same defect is the stop signal. State what you
now think is wrong before trying a third variation.

## 3b. Scan for AI tells

Run this list against the screenshot and the copy before reporting. One item
with a stated reason is fine. Several together with no reason is what makes a
page read as generated. The user's brief and the project's existing design
always win: if the project already uses a gradient, keep it.

**Absolute, no exceptions in UI copy you write:**
- No em dash (`—`) in any UI text. Use a full stop, a comma, a colon or two
  sentences. This applies to copy in any language.
- No invented stats ("99.9%", "10x", "10,000+ users"), testimonials or client
  logos. Use real figures from the user, or leave the slot out.

**Colour** — purpose test: can you say why this colour, for this subject?
- Blue-to-purple, blue-to-cyan or purple-to-pink gradients; Tailwind's default
  `indigo-500` / `violet` as the accent. The most-cited tell of all.
- Purple-and-black, neon on dark, several saturated accents at once.
- Glow backgrounds, radial "orbs", aurora blobs, bloom behind the hero.
- Warm cream (`#F4F1EA`-ish) + serif + terracotta; near-black + one acid accent.
- Accent colours cycled across cards with no meaning.

**Typography**
- Inter, Geist, Space Grotesk, Roboto, Poppins as the reflex choice; Fraunces
  or Instrument Serif as the reflex serif; Geist Mono / JetBrains Mono / Fira
  Code for small data labels. Pick a face for the subject and write the
  reason in one line. A serif is right for a formal, editorial subject; the
  reflex serif is not.
- Tracked-out ALL-CAPS eyebrow label above every heading.
- One word in a headline italicised, bolded or recoloured.
- Oversized italic serif headline as an "editorial" shortcut.

**Layout and components**
- Hero → "Trusted by" logo row → three identical feature cards → three-step
  "How it works" → three pricing columns → four-column footer.
- Every section with the same structure and rhythm.
- Cards inside cards; one radius and one soft shadow on everything.
- Pill/badge with glow above the headline.
- Glassmorphism on navbar, cards, modals and sidebar at once.
- Decorative status dots or numbered markers (01/02/03) on content that is not
  a real state or sequence.
- Bento grid or fake terminal window as the default hero visual.

**Motion**
- Fade-and-slide-up on every section; hover lift on every card; glow on
  buttons, badges and borders together; auto-scrolling logo marquee. Keep one
  orchestrated moment and motion that answers a user action.

**Icons and imagery**
- Emoji as icons, bullets or heading decoration.
- Thin-line library icons that could illustrate any product; sparkles, magic
  wands, lightning bolts, robots and orbs as "AI" signifiers.
- `→` appended to every button and link.

**Copy**
- Buzzwords: seamless, unlock, elevate, supercharge, revolutionary, next
  generation, cutting-edge, powerful, effortless, world-class, AI-powered.
  Their equivalents in the project's own language count too. In Brazilian
  Portuguese: "revolucionário", "potencialize", "eleve", "de outro nível",
  "sem complicação".
- Default CTAs: Get Started, Learn More, Try Now, Explore, Discover (and their
  equivalents, such as "Saiba mais", "Comece agora"). Name what happens: "Book a
  table", "Send for review".
- Slogan patterns that say nothing: "Build faster. Ship smarter.",
  "Not a feature. A platform.", triplets of adjectives.
- Meta strings joined with middle dots (`A · B · C`).
- Two labels for the same action on one page ("Book a table" in the hero,
  "Reserve my table" in the footer). Every button that starts the main
  action uses the main action label from the locks, word for word. A
  per-item action ("View menu" on each card) is a different intent.
- Copy that is cute but says nothing, has an unclear referent ("we plan to
  keep it that way"), or is grammatically off. Reread every visible string
  once before reporting and rewrite those as plain functional sentences.

Sources, for when this list needs updating: the anti-slop ruleset
(github.com/miqdadbadjuber/anti-slop, MIT), taste-skill
(github.com/Leonxlnx/taste-skill, MIT), impeccable.style/slop,
thefountaininstitute.com/blog/signs-vibe-coded-ui, and the calibration list in
your design-direction skill, if you have one.

## Debugging a visual bug

A visual bug is not reproduced until you have a screenshot of it. Before
touching code:

1. Screenshot the broken state and name the defect in the picture (which
   element, which edge, how far off).
2. Read the numbers behind it — bounding rect, computed style, transform, the
   prop's position and rotation — so the fix targets a measured cause, not the
   look of it.
3. After the fix, screenshot the same view at the same size and compare the
   two. A fix you did not see is unverified; say so.

## 4. Report with the picture

Lead with the screenshot or the URL, not a paragraph. Name the differences from
the target that remain on purpose, and any value you had to invent. If a
browser could not be reached, say the result is unverified visually — do not
describe a page you did not see.

## Games and 3D

The same loop applies to level layout, building placement, meshes, materials
and HUDs. In one game project, the correction rounds were almost all this
category: walls built facing the wrong way, a dock and mill diagonal to the
river, a village that "was just thrown around", kit houses that read "funky".

- **Set the target before generating, in the planning phase, not when the
  art phase arrives.** A reference description or image set, and a top-down
  layout plan: what faces what, what aligns to the river or road, spacing
  between buildings, the silhouette the player sees on arrival. Write it into
  the project docs. Placement by rule with no plan is how that village came
  out scattered.
- **Hands-off mode.** When the user has opted out on purpose (no spoilers,
  "build it 0 to 100 without me"), you are the art director. Do not ask them
  to confirm the target. Set it yourself, hold every screenshot against it,
  and use the `reviewer` agent or a project design critic as the second pair
  of eyes the user would otherwise be. Never show them story or level
  content to get a sign-off.
- **Frame proof at the player's camera.** Survey shots from 30-60 m hid black
  wall slabs that were obvious at play zoom. One shot per asset type, at play
  distance, plus one overview.
- **Judge at the play camera distance.** Set the editor camera and capture the
  viewport through your engine's tooling, so the shot matches what the player
  sees.
- **Measure bounds rather than estimate.** Read real sizes from the engine's
  mesh and actor bounds before placing anything.
- **Check orientation against the feature it relates to.** Which side of a
  wall faces out, which edge of a dock meets the water, whether a building
  straddles a river. Read the yaw and bounds; then confirm in the picture.
- **A subagent's "it renders" is not evidence.** You open the PNG. Numeric
  gates (triangle counts, section counts) are a floor, not the verdict.
- **Prove a HUD in the running game.** A HUD created at runtime is proven by a
  screenshot of the running game, not an editor viewport capture; the editor
  capture will not contain it.
- Placeholder art that the user has not approved is not final art. Say which
  assets are placeholders in every report.

## False finishes to avoid

- A green build is not a visual result.
- A screenshot taken before the dev server reloaded shows the old code — confirm
  the change is in the frame.
- A desktop screenshot says nothing about mobile.
