# Landing, marketing and portfolio pages

Read this before step 2 of ui-refine when the page sells, introduces or shows
off something: a product landing page, a marketing site, a portfolio, a store
page. Not for editors, dashboards, checkout or admin screens.

Adapted from taste-skill (github.com/Leonxlnx/taste-skill, MIT). Its stack,
font and palette prescriptions were left out on purpose: the project and the
locks in step 1 decide those.

## Hero

- Fits the first screen at 1440x900 and at 390x844: headline at most 2 lines,
  supporting text at most 20 words, the main button visible without scrolling.
- At most 4 text elements: an optional small label, the headline, the
  supporting text, the buttons (one primary, at most one secondary).
- Trust strips, logo rows, pricing teasers and feature bullets go in the
  sections below the hero, not inside it.
- Top padding at most 96px at desktop. More space comes from a larger
  headline or image, not from pushing the content down.
- The hero has a real visual: a product screenshot, a photo, a generated
  image (an image-generation skill, if you have one), or a labelled placeholder slot listed in the
  report. A headline over a gradient blob is unfinished.

## Navigation

- One line at 1024px wide. If it wraps, shorten labels, drop secondary items
  or move them into a menu.
- Height 64-80px.

## Section rhythm

- Each layout family (three cards, image beside text, full-width quote,
  grid of tiles) appears once per page.
- At most two image-beside-text sections in a row.
- Small uppercase tracked labels above headings: at most one per three
  sections, the hero included. Count them before reporting.
- Default section content: a headline of at most 8 words, a paragraph of at
  most 25 words, and one visual or one button.
- More than 5 items: group them, or use tabs, an accordion or a card grid.
  Not a long list with a hairline under every row.
- A tile grid has exactly as many tiles as items. No empty tile.

## Proof and imagery

- Logos, quotes and numbers only when the user supplied them. A logo row sits
  below the hero and holds logos only, with no category label under each.
- Quotes: at most 3 lines, attributed with name and role.
- No product UI faked out of styled divs (fake dashboard, fake terminal, fake
  task list). Use a real screenshot, a generated image, or leave it out.

## Before reporting

Screenshot the full page at desktop and phone width, and in dark mode too if
the page supports it. Check every rule above against the screenshot, and list
any rule you broke on purpose, with the reason.
