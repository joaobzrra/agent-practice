# context-ledger

A ledger of a project's decisions, hazards and open questions, stored as JSON
in the project and put in front of the agent by a hook. Each entry is a
**claim**. On every prompt the hook scores the claims against the prompt and
injects the ones that match, so a session does not have to know a rule exists
in order to be told about it.

This folder is the whole tool: a CLI, a hook, three JSON schemas and the tests.
In the repository it comes from, `ledger/README.md` shows it running on an
invented project, and `skills/ledger/SKILL.md` is the skill that tells an agent
when and how to write a claim.

## Requirements

- Node 24 or newer (that is what it is tested on).
- Two dependencies, `ajv` and `ajv-formats`, which check records against the
  JSON schemas. Every CLI command needs them installed. The hook imports
  nothing outside Node and keeps working without `node_modules`.

## Install in your project

The tool finds its project by position: the project root is three folders
above `src/`. So the folder has to sit at exactly
`<your project>/tools/context-ledger`. There is no flag to point it elsewhere.

1. Copy this folder to `<your project>/tools/context-ledger`. Skip
   `node_modules` if it is there; the next step recreates it.
2. Install the two dependencies:

   ```
   cd <your project>/tools/context-ledger
   npm install
   ```

3. Create the ledger. This writes `<your project>/context/` and refuses to run
   if that folder already exists:

   ```
   node src/cli.mjs init --name "My Project"
   ```

4. Register the hook. Merge this into `<your project>/.claude/settings.json`:

   ```json
   {
     "hooks": {
       "SessionStart": [
         {
           "matcher": "startup|resume|clear|compact|fork",
           "hooks": [
             {
               "type": "command",
               "command": "node",
               "args": ["${CLAUDE_PROJECT_DIR}/tools/context-ledger/src/hook.mjs", "SessionStart"],
               "timeout": 5
             }
           ]
         }
       ],
       "UserPromptSubmit": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "node",
               "args": ["${CLAUDE_PROJECT_DIR}/tools/context-ledger/src/hook.mjs", "UserPromptSubmit"],
               "timeout": 5
             }
           ]
         }
       ],
       "SubagentStart": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "node",
               "args": ["${CLAUDE_PROJECT_DIR}/tools/context-ledger/src/hook.mjs", "SubagentStart"],
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

5. If the ledger will be committed, pin its line endings. Add to
   `<your project>/.gitattributes`:

   ```
   context/** text eol=lf
   ```

   `build-index --check` compares bytes, and a Windows checkout otherwise
   turns the generated files into CRLF and reports drift that is not there.

6. Write a first claim. `context/claims.json` is a JSON list; this is one
   complete claim, with every required field:

   ```json
   [
     {
       "id": "CLM-prices-in-cents",
       "title": "Prices are stored as whole cents",
       "statement": "Every price and total is stored as a whole number of cents (1999 for 19.99), never as a decimal. Decimal arithmetic once charged customers one cent too much. Convert to a display string only where the number is shown.",
       "kind": "invariant",
       "state": "accepted",
       "authority": { "kind": "user", "source": "owner, in session", "decidedAt": "2026-01-15T00:00:00Z" },
       "scope": {
         "topics": ["price", "prices", "total", "checkout", "cents", "rounding"],
         "paths": [],
         "entities": ["cents"]
       },
       "universal": false,
       "severity": "high",
       "relationships": [],
       "evidence": [],
       "history": [
         { "from": null, "to": "accepted", "at": "2026-01-15T00:00:00Z", "actor": "user", "source": "owner, in session" }
       ]
     }
   ]
   ```

   The allowed values for each field are in `context/schemas/claim.schema.json`.
   `authority.source` is free text or a file name.

7. Run the two gates. `validate` must print `valid: 1 claims, ...`:

   ```
   node src/cli.mjs validate
   node src/cli.mjs build-index
   ```

8. Check that the claim reaches a prompt, and that an unrelated prompt does
   not get it. `route` prints what the hook would inject:

   ```
   node src/cli.mjs route --prompt "change how the checkout total is calculated" --format markdown
   node src/cli.mjs route --prompt "rename footer link" --format markdown
   ```

   The first should list `CLM-prices-in-cents`. The second should print the
   heading and no claim. Run the second one: in a small ledger almost any
   sentence shares a word with a claim, so the first check alone proves little
   (see the limits below).

9. Only if you want `npm run ci` to pass: list the project's documents in
   `context/documents.json`. `audit-documents` fails for every Markdown file it
   finds that is not listed, and a new project already has a `README.md`. One
   entry looks like this:

   ```json
   [
     {
       "id": "DOC-readme",
       "path": "README.md",
       "title": "Project readme",
       "kind": "readme",
       "state": "current",
       "authorityRank": 40,
       "stateAsOf": "2026-01-15",
       "topics": [],
       "replaces": []
     }
   ]
   ```

Start a new session in the project. The first message should now arrive with a
block that begins `# My Project routed context` and lists your claim by id.
The heading alone means the hook runs but nothing matched.

To try the hook by hand, pipe it what the agent sends:

```
echo '{"session_id":"try-1","prompt":"change how the checkout total is calculated"}' | node src/hook.mjs UserPromptSubmit
```

It prints JSON once. The same `session_id` and prompt a second time prints
nothing: the hook does not repeat a block it already injected in that session.

## What `init` creates

```
context/
  claims.json          the claims
  documents.json       the project's documents and which one is current
  scenarios.json       retrieval tests: a prompt, some paths, the claims expected back
  ledger.config.json   { "repository": "<folder name, lower case>", "displayName": "My Project" }
  schemas/             the three JSON schemas, copied from templates/schemas
  generated/           written by build-index; never edit by hand
```

`displayName` comes from `--name` and is the heading of every pack.
`repository` is the project folder's name in lower case unless you pass
`--repository`; it names the folder where the hook keeps its per-session state.

## Commands

All run from `tools/context-ledger`.

| Command | What it does |
|---|---|
| `node src/cli.mjs init [--name <text>] [--repository <slug>] [--root <dir>]` | Creates `context/`. Refuses if it exists. |
| `node src/cli.mjs validate` | Checks every record against its schema, the state history of each claim, references between claims, and that the always-injected claims fit the budget. |
| `node src/cli.mjs route --prompt <text> [--paths a,b] [--limit N] [--format markdown]` | Prints the pack for a prompt. JSON unless `--format markdown`. |
| `node src/cli.mjs expand --claim <id>` or `--topic <topic>` | Prints whole claims. |
| `node src/cli.mjs build-index [--check]` | Writes `context/generated/`. With `--check` it writes nothing and fails if the files differ. |
| `node src/cli.mjs check-stale [--base <commit>] [--verify]` | Re-reads every evidence anchor and reports claims whose quoted file content changed. |
| `node src/cli.mjs audit-documents` | Fails if a Markdown file in the project is not listed in `documents.json`, or a listed one is missing. |
| `node src/cli.mjs review-packet [--apply <file>]` | Prints the claims waiting for a ruling. `--apply` records decisions from a JSON file. |
| `node src/cli.mjs dashboard` | Prints a JSON snapshot: every claim, its evidence health, what needs a ruling. |
| `node src/evaluate.mjs` | Runs every scenario and fails if an expected claim did not come back. |
| `node check-vendor.mjs <other copy>` | Reports whether another project's copy of this folder still matches this one. |

`npm test` runs the tool's own tests. `npm run ci` runs those, then the
scenarios, `validate`, `audit-documents` and `build-index --check` against your
project's ledger.

## What the hook does

| Event | What is injected |
|---|---|
| `SessionStart` | The claims marked `universal`, the contested ones, any claim that happens to share a word with the fixed start-up prompt (`session start universal invariants critical conflicts`), whether the git worktree is clean, and a claim count. |
| `UserPromptSubmit` | The pack routed for that prompt, up to 24 claims. |
| `SubagentStart` | The universal claims plus the pack of the session's latest prompt. |

A pack groups claims under four headings, chosen by the claim's `kind`, not by
how sure anyone is:

| Heading | Claims under it |
|---|---|
| Open conflicts | `kind: conflict`, or any claim in state `contested` |
| Binding invariants | `kind: invariant` |
| Accepted intent | `kind: intent` |
| Current verified facts | everything else: `fact` and `hazard`, in any routed state, including `accepted` |

The hook remembers what it already injected in a session (a small JSON file in
the system temp folder, in `context-ledger/<repository>/`) and does not repeat
an identical block.

**It fails open and silent, on purpose.** Any error, including a missing
`context/` folder or broken JSON, makes the hook print nothing at all and the
session continues without a pack. A working hook with no matching claim still
prints the heading line. Inside a session you are unlikely to notice either,
so if claims stop appearing, run `node src/cli.mjs validate`.

## How a claim is chosen

Retrieval matches words. It does not understand meaning.

- Each word of three or more characters that the prompt shares with the claim's
  topics, entities, title or statement adds 2.
- Each path given with `--paths` (or in a scenario) that starts with one of the
  claim's `scope.paths`, or the reverse, adds 12.
- A `contested` claim gets 3 added.
- A claim scoring 0 is left out, unless it is `universal` or is linked by
  `conflictsWith` to a claim that routes. Both sides of a known contradiction
  always arrive together.
- `proposed` and `superseded` claims are never routed.

When more claims match than the budget allows, universal claims go first,
ordered by severity. The rest are ordered by score.

## Limits you should know before relying on it

All of these were checked against the code or by running it.

- **In a live session, paths do not count.** The prompt hook passes the prompt
  text and no file list (`src/hook.mjs`, the `UserPromptSubmit` branch). The
  12 points for a path apply to `route --paths` and to scenarios only. A claim
  that can be found only through `scope.paths` passes its scenario and still
  never reaches a session. Give every claim words a real prompt would contain,
  and test it with `route` **without** `--paths`.
- **A contested claim routes for every prompt.** The 3 points for `contested`
  put its score above 0 whatever the prompt says. That is intended (an open
  disagreement should be seen), and while the pack has room it means a
  contested claim costs what a universal one costs. Once more than 24 claims
  match, a contested claim with no other match is among the first left out. It
  also means `route` cannot tell you whether a contested claim's words are any
  good.
- **Common words match.** "the" has three letters. In a small ledger most
  claims share some word with most prompts, so nearly everything is injected.
  Selection only becomes visible once the ledger is larger than the budget.
- **`route` does not print scores.** You see which claims came back, not why.
- **The `symbol` evidence locator reads C# declarations only.** For other
  languages anchor evidence with `excerpt`, `heading`, `jsonPath`, `yamlPath`
  or `file`.
- **Three commands run shell commands stored in `claims.json`** (the
  `verification.command` of an evidence entry): `check-stale --verify`,
  `check-stale --base <commit>` for claims whose evidence file changed since
  that commit, and `review-packet --apply` for a "verify" decision. Review a
  change to that field the way you review a change to a script, and do not run
  `check-stale --base` on a pull request from someone you do not trust.
- **`audit-documents` wants every document registered.** It looks at
  `README.md`, `CLAUDE.md`, `AGENTS.md` and `HANDOFF-*.md` in the project root
  and every `.md` under `docs/`, `deploy/runbooks/`, `.claude/skills/` and
  `context/`. `npm run ci` includes it. If you do not want a document
  registry, run the other steps on their own.
- **`init` has no rollback.** If it fails halfway, delete the new `context/`
  folder and run it again.
- **One copy per project, and a real copy.** Because the tool finds its
  project by position, it is copied into each project. Edit one copy only, and
  use `check-vendor.mjs` to see whether the others still match. Do not replace
  the folder with a symlink or a junction to a shared copy: run through a
  link, the hook prints nothing.

## Tests

```
npm test
```

57 tests. They build an invented project in a temp folder
([`fixtures/project.mjs`](fixtures/project.mjs)) and run against that, so they
pass wherever this folder is copied. One test compares `templates/schemas`
with your project's `context/schemas` and is skipped until `init` has run.

Not tested: macOS, and Node versions older than 24.
