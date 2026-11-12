# 78 failures, one cause

## What happened

A test suite failed 78 of its 131 checks. Every failure had the same empty
detail. It looked like a sweeping regression (working behaviour that broke).

The cause was one line near the top of the log: the interpreter the suite
needed was not found, because one environment variable was not set.

## Why it happens

An agent, like a person, starts with the first failing test and tries to fix
it. With 78 failures it can spend a long time "fixing" tests that were never
broken, and change working code while doing so.

## The rule

- Many failures that look the same are evidence against a real regression.
  Real regressions fail in specific places. A missing prerequisite fails
  everything the same way.
- Read the top of the log for the one root error before opening any single
  failure.
- Before believing a mass failure is caused by your change, run the same suite
  without your change.
