# Renderer-side pollers follow Settings → Polling

## Context
Settings → Polling (`configurable-polling-intervals`) only reached the bun-side loops. Two renderer timers kept running on hard-coded cadences: the open task's branch-status poll (`useTaskBranchStatus`, every 15 s, each tick running `gh pr list --head`) and the board's PR discovery (`useTaskPrBadges`, `gh pr list --state open` per project every 60 s). The "Task git bar" switch only throttled the `git fetch` inside the first one, so turning it off left the `gh` traffic untouched.

## Decision
Two new groups, `branchStatusPoll` and `projectPrList`, live in `GlobalSettings.polling` beside the existing four. The renderer reads them through `usePollingSettings()` (`src/mainview/hooks/usePollingSettings.ts`). That hook seeds from `global-settings-cache.ts` so the first tick already uses the user's cadence, follows `globalSettingsUpdated` so a change applies without a remount, and is depended on only through primitive values. The branch-status interval is stored in a new `seconds` map (5–3600 s, default 15), because its default is below the one-minute floor of the `minutes` map. Switched off, the branch status still loads once when a task opens, and ↻ plus the post-git-op refresh keep working, so the git bar is never left empty. The merge popup's once-guard reset moved into its own effect, so restarting the poll after a settings change cannot re-offer a merge.

## Risks
With branch status off, the uncommitted and ahead/behind counts go stale until the user refreshes. The Task git bar fetch also stops, because it only ever runs inside a status poll. Both are the explicit opt-in the user asked for. A 5 s floor still allows about 720 `gh` calls an hour per open panel; it exists to stop typos, not to enforce a quota.

## Alternatives considered
- Keeping minutes and moving the default to 1 min was rejected: it would silently slow every existing install's git bar.
- An off switch that skips only the `gh` lookups but keeps polling local git was rejected by the user in favor of stopping the whole refresh.
- Storing seconds inside the `minutes` map was rejected because the on-disk name would then lie about its unit.
