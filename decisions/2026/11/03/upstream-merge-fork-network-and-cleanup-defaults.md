# Preserve fork network policies and opt-in cleanup

## Context

Upstream through `916ceaf9` adds daily worktree cleanup, model-price refreshes and workflow features. This fork must retain its custom workflows, ship no telemetry or updater, and leave automatic cleanup disabled until the user enables it.

## Investigation

Cleanup's upstream default was independently encoded in the settings loader, scheduler, toggle and persistence handler. New pricing code imported the removed telemetry identity module and fetched a fixed external catalog automatically when reading cost reports.

## Decision

`settings.ts`, `worktree-cleanup-scheduler.ts`, `GlobalSettings.tsx` and `SystemSettingsSection.tsx` require and preserve an explicit boolean `true` for cleanup. Retain upstream cost reporting with local cached or bundled prices, remove network refreshes, and preserve the fork's existing telemetry, updater and external deep-link removals while merging upstream features.

## Risks

Local prices can become stale until a new build supplies updated rates. An explicitly enabled cleanup retains upstream's age thresholds and deletion behavior; older installed upstream builds can still apply their own defaults to shared state.

## Alternatives considered

Default-on cleanup with a launch delay still deletes files without an opt-in. Restoring an opt-out telemetry dependency for price refreshes violates the fork's runtime policy and creates a new automatic network request.
