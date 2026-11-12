# One file wins

## What happened

A project had two instruction files for agents. One was a full copy of the
other, made for a different tool. The copy was not updated when the project
changed, and for a while it told agents that a system was read-only after that
had stopped being true. An agent that read the stale file acted on dead
guidance.

## Why it happens

Every agent session starts by reading documents. It cannot tell an old document
from a current one; both look equally sure of themselves. With several
documents, sooner or later two of them disagree.

## The rule

- **One file is the single source of truth for current state, and every other
  document says so.** The winner says "when another file disagrees with this
  one, this one wins". The others say the same thing about the winner.
- **Pointer files stay bare.** A second instruction file holds one line
  pointing at the first. A pointer cannot go stale.
- **Superseded documents get a visible banner, not deletion.** "Trust the
  banner, not the body" keeps the history readable without misleading anyone.
- **Handoffs are observations, not authority.** A dated session note describes
  what was true that day. It is replaced by the next one; it is never the place
  where a rule is changed.
