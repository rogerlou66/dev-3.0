# Configurable background polling (Settings → Polling)

## Context
Four background loops reach the network on fixed cadences: the merge-detection poller (`git fetch` + merged check), the PR-status poller (`gh`), the task git bar's fetch, and the Pull button's "behind origin" fetch. Users on metered links, rate-limited `gh` accounts or many repos had no way to slow them down or turn them off.

## Decision
`GlobalSettings.polling` stores sparse overrides: whole minutes per interval and an `off` flag per group. `src/shared/polling-settings.ts` (`resolvePolling`) turns it into milliseconds and is read on every tick by `checkMergedBranches` / `checkOpenPRsForPromotion` (`src/bun/lifecycle/activities.ts`) and per poll by `getBranchStatusImpl` / `maybeRefreshOriginRef` (`src/bun/rpc-handlers/git-operations.ts`), so a change applies without a restart. Values are clamped to 1–120 min, because both pollers tick once a minute and could not honor anything finer. The git bar previously fetched on every 15 s poll, limited only by the 5 s fetch cooldown; it now gets its own per-task throttle, defaulting to 1 min. The UI lives in a dedicated Settings category instead of System, which already carries updates, lifecycle, proxy and developer tools.

## Risks
An off switch silences merge-completion prompts or PR/CI badges until the user refreshes by hand. That trade-off is accepted because the switch is explicit and opt-in. Re-enabling a poller after a long pause looks like a wake from sleep, so overdue tasks are re-spread instead of firing together, which is the intended behavior.

## Alternatives considered
- A single global "polling multiplier" was rejected: the four loops have different costs (`gh` API quota vs. local `git fetch`).
- Per-project overrides were rejected as premature; the global setting covers the reported need.
- Letting explicit refreshes obey the settings was rejected, because a user action must never be silently skipped.
