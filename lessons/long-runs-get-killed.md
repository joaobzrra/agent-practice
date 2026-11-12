# The machine restarted itself at 04:29

## What happened

An overnight job was started at 02:42. The pre-flight had checked sleep timers,
the graphics card, free disk space and the input files. At 02:50 the operating
system began installing a security update. At 04:29, just after the configured
"active hours" ended, it restarted the machine by itself. The operator woke up
to a lock screen and an interrupted job.

Long interactive runs are also cut off by usage limits, closed terminals and
memory guards. It happens often enough to plan for.

## Why it happens

A pre-flight checks what the author thought of. Each new cause of death is one
nobody thought of yet.

## The rule

- **Write the handoff before the deep work.** A stub that says what is about to
  happen, updated after each piece lands, survives a cut-off. A perfect handoff
  that was never written does not.
- **Make long jobs resumable.** The job that died here skipped the chapters it
  had already finished when restarted, so only the tail was lost.
- **Check what can restart the machine.** On Windows: is an update pending or
  installing, and when do active hours end? Ask the operator to pause updates
  before an overnight run.
- **Prefer the operator launching long jobs in their own terminal.** A job
  started inside an agent session dies with that session.
- Add each new cause to the pre-flight list the day it happens.
