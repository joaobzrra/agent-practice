# Review a spec as a page with examples

## What happened

Plans and specs used to go to the operator as long Markdown files. The operator
judges work by looking at it and loses focus on long text, and said so.

For one feature (a scheduled social-media post), the spec was built as a single
HTML page instead. It held:

- a timeline of one normal day, hour by hour;
- worked examples on the operator's real data: their actual post titles, each
  one judged by the proposed rule, with the caption that would be generated;
- a mock-up of the admin screen;
- a short glossary of the status names;
- the hard rules, and the steps only the owner can do.

The operator's reaction: "I review everything without a problem."

## Why it happens

A rule in prose ("posts are skipped when the title matches X") is approved
because it sounds reasonable. The same rule applied to ten real titles shows
at once whether any of them is handled wrongly. People catch errors in examples
that they cannot catch in descriptions.

## The rule

- A spec or plan that someone must approve goes to them as a page they can look
  at, not a wall of text.
- Include worked examples on their real data, not invented samples.
- Show the screen, even as a rough mock-up.
- A Markdown copy can still live in the repository for the agents. The page is
  what the person reviews.
