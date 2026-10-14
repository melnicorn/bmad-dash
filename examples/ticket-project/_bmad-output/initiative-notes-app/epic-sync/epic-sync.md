---
type: epic
title: Sync notes between devices
parent: initiative-notes-app
covers: [CAP-2, CAP-3]
after: [epic-editor]
assignee: ""
risk: high
---

# Sync notes between devices

## Description

Push and pull notes through a sync service, and resolve the conflicts that
offline editing creates.

## Done when

1. A note written offline on one device appears on the other once both are online.
2. Two offline edits to one note resolve without losing either.

## Notes

- Waits on epic-editor because: it needs the on-disk note format and the save path.
