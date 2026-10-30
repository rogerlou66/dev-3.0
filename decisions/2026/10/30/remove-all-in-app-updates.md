# Remove every in-app update path: desktop, headless and CLI

## Context

This fork already made desktop updates manual, but both remaining paths still pulled builds from the upstream release feed (`releases.h0x91b.com`): `dev3 remote` polled it every 30 minutes and could install an upstream build unattended, and the desktop "Check for Updates…" menu downloaded and applied one on a click. Either would replace this fork's code — telemetry removal included. The fork is built from source, so an upstream build is never the right update.

## Decision

Delete all of it rather than gate it:

- **Headless/CLI:** `src/bun/self-update.ts`, `src/bun/self-update-watch.ts`, `src/shared/self-update.ts`, the `dev3 update` command (and its `--supervise` relaunch entry), the `remote.selfUpdate` socket method, the remote-state `handoff` / `lastUpdate` / `updateAttempts` fields, tunnel adoption in `cloudflare-tunnel.ts`, `tunnel-host-memory.ts`. Exit code 15 is retired, never reused.
- **Desktop:** `src/bun/updater.ts`, `src/bun/windows-update/`, the "Check for Updates…" and "Update Popover Preview" menu items, the header update plaque / popover / pinned prompt and the pinned toast slot, the `checkForUpdate` / `downloadUpdate` / `applyUpdate` / `getUpdateRestartContext` / `previewUpdatePopover` / `checkCanaryChannelAvailable` RPCs and the `updateAvailable` / `updateDownloadProgress` / `updateCheckOutcome` pushes.
- **Settings:** `updateChannel` and `remoteSilentUpdate` are removed from `GlobalSettings`, the loader and the Settings UI, along with the "Remote boxes self-update" tip.

Only the bundle's own `version.json` is still read, through `src/bun/app-version.ts`, for the About dialog and window title. `manual-updates-only.test.ts` guards that none of the above returns. The release pipeline (`scripts/`, `.github/workflows/`) is untouched; it still produces upstream's feed.

## Risks

A build runs until it is rebuilt from source and reinstalled; a `dev3 remote` restart starts a fresh tunnel, so the quick-tunnel URL changes. `settings.json` loses `updateChannel` / `remoteSilentUpdate` on the next save, so an older co-installed build reading it falls back to its own defaults (stable channel, remote self-update on) — acceptable because those builds are exactly what this fork no longer runs. Older builds may still write the removed `state.json` keys; this build ignores them.

## Alternatives considered

Keeping a manual "update" button, or gating the paths behind settings defaulting off, was rejected: the code would stay one click from installing an upstream build over the fork.
