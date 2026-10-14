---
title: 'Save without being asked'
type: 'feature'
ticket: '2'
created: '2026-02-04'
status: 'in-progress'
route: 'full'
risk: 'high'
review: ''
followup_review_recommended: false
---

<intent-contract>

## Intent

**Problem:** A note lives only in memory, so a crash loses it.

**Approach:** Debounced write-to-temp then rename, which is atomic on every
platform we target. A generation counter lets the reader pick the newer of
two files if a rename is interrupted.

</intent-contract>

## Implementation Notes

The debounce is 400 ms; a pending write is also flushed on blur and on the
window close handler.

## Review Triage Log

Nothing yet — the build is still running.
