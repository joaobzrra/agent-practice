# 28 slices, one screenshot

## What happened

A desktop-app interface was built by splitting it into 28 pieces and sending
each to a cheaper implementer agent. The whole session took one screenshot. The
operator's verdict at the end: "It's pretty, but it doesn't look like what I
expect."

In other sessions the main model wrote the styling itself and looked at the
page after each change (74 and 79 browser calls). Those sessions ended with
small tweak requests, not rewrites.

In a game project, three visuals that implementer agents reported as "proven"
showed nothing when opened. Survey shots taken from 30 to 60 metres away hid defects
that were obvious at the distance the player actually sees.

## Why it happens

An implementer agent works from a text brief. It never sees the page. Visual
quality comes from a loop: build, screenshot, compare with the target, fix.
That loop only works for the model that holds the target and the conversation.

## The rule

- Anything judged by looking at it stays with the main model: layout, spacing,
  type, motion, 3D placement.
- Delegating around it is fine. A scout can list the existing components. An
  implementer can build the API the screen calls.
- A visual claim is proven only by an image you opened yourself, framed at the
  distance the user will see it. An agent's "it renders" is not evidence.

`skills/ui-refine` is the full procedure.
