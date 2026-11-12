# A check must differ from the code it checks

## What happened

A script attached a game character's hands to its skeleton and had to decide
which way each palm faced. It used one test: the fingertips curl toward the
palm. A separate checking script then confirmed the result, and reported "palms
front, 0.5 degrees off".

The character was handed over with the backs of its hands facing forward.

The checking script used the same fingertip test as the script it checked. Both
were wrong in the same way, so they agreed. The mistake only surfaced on the
next character, whose straight fingers made the test flip the other way.

## Why it happens

A check written by the same author, in the same session, tends to reuse the
same idea. Agreement between two copies of one idea proves nothing about the
idea.

## The rule

- A verification step uses a different method than the code it verifies. Here
  the fix was to decide the palm side by the thumb, and to prove it with a
  full-body front render that a person or the model looks at.
- When a check passes, ask what it would have reported if the code were wrong
  in the most likely way. If the answer is "the same thing", it is not a check.
- When asking a reviewer agent to verify work, do not hand it the method. Hand
  it the goal and let it choose its own test.
