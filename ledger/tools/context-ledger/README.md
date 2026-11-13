# context-ledger

A ledger of a project's decisions, hazards and open questions, stored as JSON
in the project and put in front of the agent by a hook. Each entry is a
**claim**. When a prompt arrives, and when the agent reads or edits a file, the
hook scores the claims against it and sends the ones that match, so a session
does not have to know a rule exists in order to be told about it. Each claim
is sent whole, once per conversation, in a message small enough that the agent
receives all of it.

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
       ],
       "PostToolUse": [
         {
           "matcher": "Read|Edit|Write|NotebookEdit",
           "hooks": [
             {
               "type": "command",
               "command": "node",
               "args": ["${CLAUDE_PROJECT_DIR}/tools/context-ledger/src/hook.mjs", "PostToolUse"],
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

   The fourth entry is what makes a claim's `scope.paths` work: it is the only
   event that knows which file the agent has open. It starts one short Node
   process per file read or edit (0.1 to 0.2 seconds on the Windows machine
   this was measured on). Leave it out and claims are found by words only.

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

   A claim may also carry `"detail": "..."`, a longer text that the hook never
   sends: measurements, how the problem was found, what was ruled out. The
   claim is then sent as its statement followed by `[+detail]`, and
   `node src/cli.mjs expand --claim <id>` prints both. Write the statement so
   that a session which never reads the detail still does the right thing.

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

   The first should print the claim whole. The second should print
   `No claim routed for this prompt.` Run the second one too: a claim that
   comes back for every prompt is as badly scoped as one that never does.

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

Start a new session in the project. It opens with a block that begins
`# My Project routed context` and ends with a line counting the ledger's
claims. Ask about the checkout total and your claim arrives with that prompt.

To try the hook by hand, pipe it what the agent sends:

```
echo '{"session_id":"try-1","prompt":"change how the checkout total is calculated"}' | node src/hook.mjs UserPromptSubmit
```

It prints JSON holding the claim. Run it a second time with the same
`session_id` and the claim is not repeated: the output is one line naming it
as given earlier. A prompt that matches nothing prints nothing.

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
| `node src/cli.mjs validate` | Checks every record against its schema, the state history of each claim, references between claims, and that the always-injected claims fit the budget. Warns about statements too long to arrive whole. |
| `node src/cli.mjs route --prompt <text> [--paths a,b] [--limit N] [--format markdown]` | Prints the pack for a prompt. JSON unless `--format markdown`. In the JSON, `priority` lists the chosen claims most relevant first. |
| `node src/cli.mjs expand --claim <id>` or `--topic <topic>` | Prints whole claims. |
| `node src/cli.mjs build-index [--check]` | Writes `context/generated/`. With `--check` it writes nothing and fails if the files differ. |
| `node src/cli.mjs check-stale [--base <commit>] [--verify]` | Re-reads every evidence anchor and reports claims whose quoted file content changed. |
| `node src/cli.mjs audit-documents` | Fails if a Markdown file in the project is not listed in `documents.json`, or a listed one is missing. |
| `node src/cli.mjs review-packet [--apply <file>]` | Prints the claims waiting for a ruling. `--apply` records decisions from a JSON file. |
| `node src/cli.mjs dashboard` | Prints a JSON snapshot: every claim, its evidence health, what needs a ruling. |
| `node src/evaluate.mjs` | Runs every scenario and fails if an expected claim was not chosen. Also lists, without failing, each expected claim that was chosen and would still arrive as a title (`expectedByTitleOnly`). |
| `node check-vendor.mjs <other copy>` | Reports whether another project's copy of this folder still matches this one. |

`npm test` runs the tool's own tests. `npm run ci` runs those, then the
scenarios, `validate`, `audit-documents` and `build-index --check` against your
project's ledger.

## What the hook does

| Event | What is sent |
|---|---|
| `SessionStart` | The standing claims: those marked `universal`, and the contested ones. Then whether the git worktree is clean, and a claim count. |
| `UserPromptSubmit` | The claims that match the prompt and that this conversation has not been given yet. Claims it already holds are named in one line. A claim whose wording changed since it was given is sent again and said to have changed. Nothing, when nothing matches. |
| `PostToolUse` on a file read or edit | The claims whose `scope.paths` cover that file and that this conversation has not been given yet. Nothing otherwise, which is the usual case. |
| `SubagentStart` | The standing claims plus the claims the session's latest prompt was about, whole as far as they fit: a subagent starts with an empty conversation. They are read from the ledger as it is at that moment. |

**Every message fits in 9,000 characters.** Claude Code caps a hook's message
at 10,000; a longer one is replaced by a file path and its first 2,000
characters, and the agent is not told to open the file. So the hook fills the
message with whole statements, most relevant first, and lists whatever is left
by title, with the command that prints a claim in full:

```
## Also matched, by title only
These did not fit in this message. Before acting in one's area, read it whole: `node tools/context-ledger/src/cli.mjs expand --claim <id>`
- [CLM-prices-in-cents] Prices are stored as whole cents
```

A claim that has a `detail` field is sent as its statement with `[+detail]`
after it, and one line under the claims says which command prints the rest.
The detail itself is never sent.

A statement is never cut in the middle. One that is too long for the room left
keeps its title, and a shorter claim further down the list may take the room.
One prompt or file read brings at most 24 claims the conversation does not
hold yet; a claim past that is named by title in the same list, and counted in
a last line (`- and 6 more matched that are not listed`) once titles run out
of room too. The line that points back at claims already given names eight
and counts the rest, so it never takes the room of a new claim. As a last
check, the hook cuts anything still over 9,000 characters at the end of a
line and says so; that takes ids hundreds of characters long to reach.

**Each claim is sent whole once per conversation.** The hook keeps a record of
what each conversation has been given: one small file for the main
conversation of a session and one for each subagent. A claim is recorded with
a fingerprint of its state and statement, so one that is edited or contested
in the middle of a session is sent again in its new wording, with a line
naming it as changed. One that is superseded or removed is named once as no
longer in force, with its replacement when the ledger records one. The main
record is emptied when the conversation is
(`SessionStart` after a compaction, a clear or a fresh start) and kept on a
resume, which is sent only what changed while the session was away, usually
nothing. A fork is a new session with an empty record, so it is sent again
what its parent held. The files are JSON in the system temp folder, under
`context-ledger/<repository>/`; those older than 30 days are removed. Tool
calls that run in parallel run one hook each, and each adds to the record
under a short lock, so twelve files read in one step are twelve claims
recorded. If a record cannot be written, the message still goes out and the
claims are sent again next time.

A pack groups claims under four headings, chosen by the claim's `kind`, not by
how sure anyone is:

| Heading | Claims under it |
|---|---|
| Open conflicts | `kind: conflict`, or any claim in state `contested` |
| Binding invariants | `kind: invariant` |
| Accepted intent | `kind: intent` |
| Current verified facts | everything else: `fact` and `hazard`, in any routed state, including `accepted` |

**It fails open and silent, on purpose.** Any error, including a missing
`context/` folder or broken JSON, makes the hook print nothing at all and the
session continues without a pack. A working hook also prints nothing for a
prompt that matches no claim, so inside a session the two look the same. The
block at the start of the session is the sign of life: if it is missing, run
`node src/cli.mjs validate`.

## One ledger for several projects

Some lessons belong to a stack, not to a project: what a game engine does to
a packaged build, what a framework's build does to a new route. Recorded in
one project's ledger, they are learned again in the next one.

A ledger can serve sessions in other projects. Nothing is installed in those
projects.

1. Give the shared ledger a folder of its own, outside any project, and
   install the tool there as in "Install in your project": steps 1 to 3 and
   6 to 8, step 5 if the folder is a git repository, and step 9 if you want
   `npm run ci` to pass there. Step 4 is replaced by step 3 below. The folder
   then holds `context/` and `tools/context-ledger/`. This is a whole ledger
   with its own copy of the tool, not a copy of the tool shared by projects
   (see "One copy per project" under the limits).
2. Say which projects it applies to, in `context/ledger.config.json`:

   ```json
   {
     "repository": "engine-lessons",
     "displayName": "Engine lessons",
     "appliesTo": ["*.uproject"]
   }
   ```

   `appliesTo` is a list of file names, with `*` for any run of characters.
   A name, not a path: a pattern with a slash in it matches nothing. The
   ledger speaks in a session when a matching file is in the session's
   folder, in a folder above it, or in a folder directly under it. Leave
   `appliesTo` out and the ledger speaks in every project its hook runs for.

   Every folder above the session counts, up to the drive root, so choose a
   name only that kind of project has. `*.json` would match a file in your
   home folder and turn the ledger on for everything under it.
3. Register its hook in your user settings (`~/.claude/settings.json`), with
   the same four entries as in step 4 of the install, and the absolute path
   of the shared ledger's `hook.mjs` in place of
   `${CLAUDE_PROJECT_DIR}/tools/context-ledger/src/hook.mjs`.

What changes for a session in another project:

- A claim's `scope.paths` is matched against the session's project. A claim
  scoped to `Config/DefaultEngine.ini` is sent when the agent opens that file
  in whichever project it is working in. The path is counted from the folder
  that holds the file named in `appliesTo`, so it does not matter whether the
  session was started there, in a subfolder, or in a folder that holds
  several projects. Without `appliesTo` it is counted from the session's
  folder.
- In a project that is a git repository owned by another account, the line
  about the repository's state reads "Repository state unavailable". The tool
  tells git to trust only the ledger's own folder.
- The command a message gives for reading a claim names the shared ledger's
  own `cli.mjs` by its full path.
- A project can have its own ledger as well. The two hooks send two separate
  messages, each built to fit.
- `validate` measures the standing claims with the short form of the command
  that reads a claim. A shared ledger's messages spend a little more on the
  full path, so leave some room under the `standing-overflow` warning.

A ledger about one subject has words that every claim shares: the engine's
name, "game", "editor". A prompt that holds one of them would match a dozen
titles. Add this key to `context/ledger.config.json` and those words are
dropped from every prompt before claims are matched, like "the" and "that":

```json
{
  "repository": "engine-lessons",
  "displayName": "Engine lessons",
  "appliesTo": ["*.uproject"],
  "ignoreWords": ["unreal", "engine", "game", "editor"]
}
```

An ignored word finds nothing, wherever a claim holds it: in a title, a topic
or an entity as much as in a statement. Do not rely on one as a claim's only
matching word, and run `node src/evaluate.mjs` after changing the list: a
scenario whose prompt matched through an ignored word now fails.
`ignoreWords` works in any ledger, shared or not.

Keep project decisions out of a shared ledger. A claim there is read in every
project it applies to, so it must be true in all of them: name no file, class
or level that belongs to one project, except inside `detail`.

A hook in the user settings starts one Node process per prompt in every
project. In a project the ledger does not apply to, it reads one config file,
lists the session's folder, each folder above it up to the drive root, and up
to 200 folders directly under it, and exits. Measure it on your machine
before leaving it on: it is a fraction of a second, paid on every prompt.

## How a claim is chosen

Retrieval matches words and paths. It does not understand meaning.

- A word of three or more characters that the prompt shares with the claim's
  title, topics or entities adds 4. Those say what the claim is about.
- A word the prompt shares only with the claim's statement or its `detail`
  adds 2.
- A file the agent read or edited, a path given with `--paths`, or a path
  written in the prompt adds 12 when it is inside one of the claim's
  `scope.paths` (or is a folder that contains one). Folders match at a
  boundary: `src/app` covers `src/app/main.js` and not `src/application`.
  In a prompt, a bare file name with an extension counts as a path. So does
  something with a slash in it, when it ends in a file name with an extension
  or names a file or folder that exists in the project: `client/server` and
  `and/or` in a sentence are not paths. It may be only the tail of the path.
  `@src/jobs/x.js`, `src/jobs/x.js:42:7`, `src/jobs/x.js:42-50` and
  `file:///.../src/jobs/x.js:3:5` are read as `src/jobs/x.js`. An absolute
  path inside the project is read from the project root, in the Windows, Git
  Bash (`/c/...`) or WSL (`/mnt/c/...`) spelling. One from another machine,
  as in a pasted stack trace, matches a scope it contains, and only a scope
  of two folders or more: `/usr/share/docs/readme.txt` is not your `docs`.
  A path with a space in it is not recognised. In a prompt with more than
  400 different path-like words, such as a pasted log, the first 200 and the
  last 200 are read.
- A file under `.claude/worktrees/<name>/` counts as the same file in the
  project, read by a tool or written in a prompt, so a subagent working in a
  worktree is sent the claims too.
- A total under 4 counts as no match. One word found only in a statement is
  usually an accident.
- Filler words never count: "the", "that", "would", "about", "every" and
  about a hundred like them. Punctuation at the edge of a word is ignored, so "email." is
  "email".
- A `contested` claim gets 3 added, which is enough to route it with no match.
- A claim scoring 0 is left out, unless it is `universal` or is linked by
  `conflictsWith` to a claim that routes. Both sides of a known contradiction
  always arrive together.
- `proposed` and `superseded` claims are never routed.

At most 24 claims are chosen. Universal claims go first, ordered by severity.
The rest are ordered by score. That order is also the order in which whole
statements are given the room in a message. In a session, the claims a
conversation already holds do not count toward the 24, so a ledger with many
universal claims still has room for what a prompt or a file brings.

### Long prompts: asking for more than one shared word

The rule above suits a prompt that states a task. A long, conversational
prompt (a list of problems written up after a test, a pasted message) holds a hundred
ordinary words, and "need", "like" or "client" each sit in some claim's title.
Seen on a ledger of about a hundred claims: such prompts matched half the
ledger, every one filled the whole message, and none of what was sent was
used.

A ledger can ask for more, in `context/ledger.config.json`:

```json
"matching": { "minScore": 8, "topicWord": true, "detailWords": false, "perPrompt": 5 }
```

- `minScore`: the least total that counts as a match. The default is 4, and a
  smaller number is ignored. 8 is reached by two words the claim is about, by
  one of them and two from its statement, or by four from its statement
  (which `topicWord` rules out).
- `topicWord`: when `true`, at least one shared word must be in the claim's
  title, topics or entities. Words of the statement add to the score and
  cannot choose a claim alone.
- `detailWords`: when `false`, a word found only in `detail` adds nothing.
  Leave it `true` in a ledger whose `detail` holds old statements, so that
  every prompt that found a claim before still does. Turn it off where
  `detail` holds long quoted sources, whose vocabulary is not the claim's.
- `perPrompt`: the most claims a prompt's words may choose, best score first.
  The rest are not sent, not even as a title. Claims the conversation already
  holds keep their places in that count, so a second prompt on the same
  subject gets a pointer to the same few claims, not the next few down. One
  exception: a claim past the limit still arrives when `conflictsWith` ties
  it to a claim that was kept, because a contradiction is never sent by
  halves.

A claim matched by a path, a universal claim and a contested claim arrive as
they always did: none of the four can remove one, and none of them takes one
of the `perPrompt` places. `route`, the hook and `evaluate.mjs` all read the
setting.

After changing it, run `node src/evaluate.mjs`. A scenario that fails now has
a claim that depended on one shared word: give the claim the topic words its
prompt uses, as in "Prove it" in the skill. On the ledger above, about one
scenario in eight failed under the setting shown and passed again with topic
words added; the same long prompts then drew at most 5 claims each, where
they had drawn between a sixth and a half of the ledger.

This is still word matching. A stricter rule sends less that is irrelevant;
it does not make what is sent relevant.

## Limits you should know before relying on it

All of these were checked against the code or by running it.

- **A path reaches a session through the fourth hook, or not at all.** A claim
  found only through `scope.paths` arrives when the agent reads or edits a
  file under that path, or when the prompt spells the path out. Without the
  `PostToolUse` entry in `settings.json`, only the second case exists. And a
  claim scoped to a file is sent after the file is touched, so it can arrive
  after a first edit rather than before it. Give a claim that must be seen
  earlier words a prompt would contain, and test it with `route` without
  `--paths`.
- **A long statement arrives as a title.** A message holds 9,000 characters.
  About twenty claims of 400 characters fit, or two of 3,000. `validate` warns
  about any statement over 3,000 characters, and `evaluate` lists the expected
  claims that did not fit. The remedy is a shorter statement, with the
  evidence moved to the claim's `detail` field.
- **Once given, a claim is not sent again until the conversation is emptied
  or the claim is changed.** In a very long conversation a rule sent at the start is far behind the
  current work. Later prompts that match it name it in one line, and that line
  is the only reminder.
- **A contested claim opens every session.** The 3 points for `contested` put
  its score above 0 whatever the prompt says, so it is sent at session start
  beside the universal claims. That is intended: an open disagreement should
  be seen. It also means `route` cannot tell you whether a contested claim's
  words are any good.
- **Words must match exactly, and the filler list is English.** "reminders"
  in a prompt does not match the topic "reminder": list both. In another
  language the common words still count as matches.
- **`route` does not print scores.** `priority` in its JSON gives the order,
  not the numbers behind it.
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
  link, the hook prints nothing. (A shared ledger, above, is a different
  thing: one ledger that several projects read, with its own real copy of the
  tool.)

## Tests

```
npm test
```

122 tests. They build an invented project in a temp folder
([`fixtures/project.mjs`](fixtures/project.mjs)) and run against that, so they
pass wherever this folder is copied. One test compares `templates/schemas`
with your project's `context/schemas` and is skipped until `init` has run.

Not tested: macOS, and Node versions older than 24.
