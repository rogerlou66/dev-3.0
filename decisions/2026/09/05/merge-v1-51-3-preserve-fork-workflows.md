# Preserve fork workflows while merging v1.51.3

## Context

Merge upstream release `v1.51.3` (`a6c8979a`) into `rl-main` at `082d7996`. The pre-merge branch is preserved at `codex/backup-rl-main-before-v1.51.3-20260905`. There were 34 conflicted files; the user's untracked design directory and `.DS_Store` were left untouched.

## Investigation

Upstream introduced multi-project space lanes, shared PR badges, artifact lightboxes, task-movement events, notification changes and broader state backups. Textual conflict resolution alone missed the compact card's project mark, Android notification mocks, pluralized workspace counts and the Android CI installation contract.

## Decision

Keep the global Workspace Board, 52px single-line cards and text hover previews, reorderable project swimlanes, Completed disclosure, Dashboard-only header controls, Blocked holds and focused workspace overlay. Adopt upstream lane members and shared badge components, routing each card's operations to its own project. Hold-only writes must not emit a false no-op status/column movement; real status changes while blocked still enter the movement log.

Adopt the upstream App-hosted artifact popup while retaining the task overlay's effective-task context and inner-overlay-first dismissal. Preserve CJK anchor/punctuation handling alongside upstream terminal improvements. Correct the preexisting immersive exit guard to accept a workspace-overlay task and keep Dashboard mounted during immersion. Keep Android and Antigravity support, external telemetry removal and manual desktop updates; the existing separate headless self-update watcher is unchanged.

## Verification

- `TMPDIR=/tmp bun run test`: 13,832 passed, 3 skipped across renderer, backend and CLI.
- `bun run lint`, `bun run build`, frozen-lockfile install: passed.
- Real tmux guarded-input and native task-terminal lifecycle E2E scripts: passed, including reconnect, writer ownership and cleanup.
- Isolated browser QA: compact header, single-line cards, hover summary, persisted project drag order, Completed disclosure, Blocked exclusion/search/restore, workspace open/close, terminal Escape, artifact popup/Escape priority, full-page handoff, immersive return with the original filter, and 320px search.

## Risks

Android host/bridge tests pass and Android sources remain unchanged, but this machine lacks JDK/Android SDK for APK compilation and device instrumentation. Antigravity command/adapter tests pass; its CLI is not installed here, so no real Antigravity session was launched. Native macOS input-method composition/punctuation needs a user retest; automated IME tests are not physical keyboard proof. No remote push or production installation is part of this merge.

## Alternatives considered

Taking either side wholesale would remove fork workflows or discard upstream fixes. A new persisted Blocked status would change the shared data contract; retain the additive hold instead. The original pre-merge commit remains reachable for recovery.
