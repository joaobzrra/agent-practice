# Test a rule change on agents that never saw it

## What happened

The working agreement was trimmed to make it shorter. The author read the
result and found it clear. Two fresh agents were then given the file and a set
of concrete scenarios. They found roughly ten places where a sentence could be
read two ways, and where the two readings led to different actions.

Examples of what they tripped on:

- What counts as "production"? A local repository that deploys to a live
  server, or only the live server?
- "Never change a file the task did not name." Read literally, an agent would
  refuse to update the tests for its own change.
- What to do when a commit gate fails on a test the agent did not break.

After the fixes, a second round on new agents agreed on all 17 scenarios.

## Why it happens

The author knows what each sentence is meant to say, so the author cannot see
the second reading. The agent that will follow the rule later has only the
words.

## The rule

After editing an instruction file (a working agreement, a skill, a project
`CLAUDE.md`), test it before trusting it.

- Use two fresh agents in parallel, one strong model and one weaker. The weaker
  reader trips on wording the stronger one silently repairs.
- Tell them to read the file from disk. The copy loaded into their context at
  startup can be the version from before the edit.
- Give concrete scenarios: "what do you do, and which line tells you so?"
- Ask only for ambiguities that would change what they do. Without that filter
  they list subjective words for pages.
- Fix, then test again on new agents. An agent that saw the old wording is no
  longer a fair reader.
- Stop when both agents choose the same action for every scenario.
