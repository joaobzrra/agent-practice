# Field notes

Each note is one thing that went wrong, why it went wrong, and the rule it
produced. They are short on purpose. The rules in `AGENTS.md` are the summary;
these are the receipts.

Names of projects, people and servers are removed. The numbers are real.

## Working with agents

| Note | The rule in one line |
|---|---|
| [Test a rule change on agents that never saw it](test-rule-changes-on-fresh-agents.md) | A rule that reads clearly to its author can still be read two ways. |
| [28 slices, one screenshot](ui-is-not-delegated.md) | Work judged by looking at it stays with the model that can look. |
| [A check must differ from the code it checks](a-check-must-differ-from-the-code-it-checks.md) | A test that shares its logic with the code agrees with the code's mistakes. |
| [Review a spec as a page with examples](review-specs-as-a-page-with-examples.md) | People approve what they can see, not what they are told. |
| [Parallel installs drop packages](parallel-installs-drop-packages.md) | Install first, then fan out. |
| [The machine restarted itself at 04:29](long-runs-get-killed.md) | Write the handoff first and check what can restart the machine. |

## Verifying work

| Note | The rule in one line |
|---|---|
| [The leak scan that said "clean" over 44 leaks](prove-the-gate-catches-something.md) | An empty result is not a clean result until the check has caught a planted case. |
| [A green deploy hid a migration that never ran](green-deploy-hid-an-unrun-migration.md) | A health check proves only the code paths it touches. |
| [The fixture passed, the live game did not](fixture-passed-live-state-did-not.md) | Run a rule change on a copy of real state before shipping it. |
| [78 failures, one cause](uniform-failures-have-one-cause.md) | Many identical failures point to one missing prerequisite. |

## Keeping a project truthful

| Note | The rule in one line |
|---|---|
| [Write down the input, not the output](write-down-the-input-not-the-output.md) | Anything a command can regenerate is regenerated at the moment of use. |
| [A boundary is a test, not a comment](a-boundary-is-a-test-not-a-comment.md) | A comment documents a boundary; a test defends it. |
| [One file wins](one-file-wins.md) | When two documents disagree, every reader must know which one is right. |
