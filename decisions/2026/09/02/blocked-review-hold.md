# Blocked reviews retain their lifecycle status

## Context

Externally blocked reviews must leave the Workspace Board Inbox without losing their worktree or review stage. Adding a persisted TaskStatus would expose unknown values to older dev3 versions sharing the same home directory.

## Decision

Use additive Task fields (`blocked`, `blockedAt`, `blockedDurationMs`) and the per-task lifecycle mailbox. `task-blocking.ts` projects held tasks into a formal Blocked column on both boards and a sidebar tier; the existing status menus and same-project drag own the actions. Only settled human/peer reviews can be newly blocked. No reason is required in v1.

Background hooks and PR watchers may advance the underlying status but never clear the hold. Explicit unblock/drag out clears it, as do To Do and terminal transitions; runtime, worktree, hibernation and disconnection retain their existing behavior. Data writes atomically split status-time buckets at hold boundaries, attributing external wait to `blockedDurationMs` instead of human/agent time.

## Risks

Older versions ignore the new fields and render the underlying review column; they do not honor this queue exclusion or timing split. No path or status value changes, renames, or load-time migrations are introduced. Explicit moves to other lifecycle columns still carry their normal effects, unlike a hold-only change.

## Alternatives considered

A new TaskStatus requires cross-version status compatibility and wider lifecycle changes. A label or custom column alone leaves Inbox and readiness projections inconsistent, while hibernation unnecessarily destroys the runtime. A global preference hides all reviews rather than just the blocked work.
