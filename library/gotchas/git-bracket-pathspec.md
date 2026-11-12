---
id: git-bracket-pathspec
title: A bracket in a git pathspec is a glob, and returns zero silently
description: git reads [name] in a pathspec as a character class, so grep/log against a bracket-named folder silently matches nothing, which looks the same as "the code is gone". Use :(literal).
topic: gotchas
tags: [git, pathspec, glob, grep, false-negative, search]
updated: 2026-08-25
source: a repository whose folders are bracket-named
status: current
---

# A bracket in a git pathspec is a glob

Git treats `[...]` in a **pathspec** as a shell-style character class. So a
path like `modules/[shared]` matches a *single character* drawn from
`{s,h,a,r,e,d}`, not the literal folder. Nothing matches, and:

**git exits 0 and prints nothing.** That is identical to the output meaning
"this pattern does not exist in that code".

Repositories that group folders by bracketed names (`[shared]`, `[vendor]`)
are the obvious victims, but any bracket-named directory does it.

## What it cost

Checking whether an earlier cleanup had already removed some code:

```bash
git grep -c "config.debug" origin/main -- "modules/[shared]"   # -> 0
```

Zero. Conclusion drawn: already removed, the commit is redundant, skip it.
**All three parts of that were wrong.** The real answer was 4 occurrences,
including the exact leftover flag the task was about.

## The fix

Use the `:(literal)` pathspec prefix:

```bash
git grep -c "config.debug" origin/main -- ":(literal)modules/[shared]"
```

## The habit that actually saves you

The fix only helps if you notice. **Run a control pattern you know must
match.**

```bash
# If this returns 0 too, the pathspec is broken, not the code.
git grep -c "<a string you know is there>" origin/main -- ":(literal)<path>"
```

A zero result from a search is a claim about the world. Before acting on "it
is not there any more", prove the search itself works.

A faster check for the same fault: `git ls-tree <rev>:<bracket-path>` answers
`fatal: Not a valid object name` when the path does not resolve, which is
louder than grep's silence.

**Extra trap:** when the directory exists on disk, the *shell* expands the
brackets before git sees them, so the same command works. It fails silently
only where the shell cannot expand it: against a revision
(`origin/main:...`), a deleted path, or a renamed one. The identical pattern
succeeds in one place and lies in another.

## Generalizes

Any tool taking a glob-like path argument. The lesson is not really about git:
**a silent zero is not evidence of absence until the query is proven to run.**
