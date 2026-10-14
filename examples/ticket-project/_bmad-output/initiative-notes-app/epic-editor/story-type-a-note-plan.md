---
title: 'Type a note'
type: 'feature'
ticket: '1'
created: '2026-02-03'
status: 'done'
route: 'oneshot'
risk: 'low'
review: 'quick'
---

<intent-contract>

## Intent

**Problem:** There is nothing to type into yet.

**Approach:** One full-window text view, focused on mount, backed by a
string in memory. Persistence is ticket 2's.

</intent-contract>

## Implementation Notes

The caret is focused in `onMounted`, which also covers the reopen case
once ticket 3 restores a note.

## Auto Run Result

All checks passed on the first run.
