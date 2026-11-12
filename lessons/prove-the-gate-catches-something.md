# The leak scan that said "clean" over 44 leaks

## What happened

Before publishing a repository, a scan looked for personal paths in every file.
It was a search with a regular expression (a text pattern) that listed several
Windows paths, each with its backslashes escaped.

It reported the repository clean. One private path was in it 25 times, and
another 19 times. A plain fixed-string search for the same path found all of
them at once.

## Why it happens

Each layer the command passes through (the agent's tool, the shell, the search
program) removes one level of backslash escaping. What reaches the search is no
longer what was written, and it matches nothing.

The failure is silent. "No matches" looks exactly like "clean". For a check
whose whole job is to catch something, that is the worst way to fail.

## The rule

- **Prove a gate catches something before trusting that it found nothing.**
  Plant a known bad string, run the gate, and see it fail. Then remove the
  plant.
- Match paths as fixed strings, never as a pattern. Write the scan in a real
  language that reads the file and tests `line.includes(literal)`.
- Keep patterns only for name-shaped things with word boundaries.
- The same trap applies to search-and-replace on paths. Use a script that
  splits and joins on the literal text.
