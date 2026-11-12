# The fixture passed, the live game did not

## What happened

A turn-based strategy game got a new rule: countries can join a war as a
coalition. Every test passed. The tests ran on a fixture world (a small,
hand-made test world) of five countries.

Before deploying, the new engine was run for a few turns on a copy of the live
game's state, which has about 195 countries. Within four turns, 13 countries
piled onto every war started by one large power, including countries on the
other side of the world, because in the live game that power was disliked
almost everywhere.

An independent reviewer agent then found four more defects in rules that had
already shipped. One of them let a single computer player's grudge dissolve an
entire alliance.

## Why it happens

A fixture is built by the person who wrote the rule, with the values that
person imagined. Real state has extremes nobody imagined, and rules interact at
a scale a five-item fixture cannot show.

## The rule

- Before deploying a change to rules or business logic, copy the live state
  read-only and run the new code on the copy for several steps.
- Look at what fires on each step (how many joins, sanctions, breaks), not only
  whether the run finishes.
- Do it in a throwaway test file and delete the file afterwards.
- For a change that spans several commits, run the independent reviewer before
  the deploy, not after.
