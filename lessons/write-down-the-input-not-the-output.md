# Write down the input, not the output

## What happened

One production server had no git. A deploy there meant a person uploading a
list of files by hand. That list was written into the status document.

A week later the status document said 5 files. The handoff written the same
week said 6. The real difference between the deployed version and the current
one was 7.

The two missing files were the worst pair to leave out: the interface that
declares the methods the new code calls, and the config file that holds the new
key it reads. Uploading the written list would have shipped code without the
things it depends on, and it would have failed on a real customer's order.

## Why it happens

A file list is a derived fact: it is the difference between two versions.
Writing it down turns it into a claim someone must keep up to date by hand. The
event that changes it (a new commit) is not an event that makes anyone re-read
the document. The sentence still looks specific and confident, so nobody doubts
it.

## The rule

- Record the input: the commit that was last deployed. That is a real event and
  it does not drift.
- Regenerate the output at the moment of use:

```
git diff --name-only <last-deployed-sha>..HEAD
```

- More generally, anything a command can regenerate is regenerated when it is
  needed, never copied into a document. This applies to file lists, counts,
  version numbers and "current state" summaries.
