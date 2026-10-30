# Remove headless self-update and the `dev3 update` command

## Context

This fork already made desktop updates manual, but `dev3 remote` kept a 30-minute watcher that polled the upstream release feed (`releases.h0x91b.com`) and, once the box went quiet, installed the upstream build over this fork's install. It was blocked only by a channel/install-method mismatch on this machine, so one aligned release could have replaced the fork's code — telemetry removal included. The fork is built from source, so an upstream build is never the right update.

## Decision

Delete the whole headless self-update path rather than gate it: `src/bun/self-update.ts`, `src/bun/self-update-watch.ts`, `src/shared/self-update.ts`, the `dev3 update` command (and its internal `--supervise` relaunch entry), the `remote.selfUpdate` socket method, the remote-state `handoff` / `lastUpdate` / `updateAttempts` fields, the tunnel adoption code in `cloudflare-tunnel.ts`, `tunnel-host-memory.ts`, the "Update a remote box on its own" setting and its tip. In headless mode `checkForUpdate` / `downloadUpdate` / `applyUpdate` in `rpc-handlers/settings-config.ts` refuse without touching the updater. Exit code 15 is retired, never reused. `manual-updates-only.test.ts` guards that none of it returns.

## Risks

A `dev3 remote` box must be updated by rebuilding and restarting it, and a restart now starts a fresh tunnel, so the quick-tunnel URL changes. `remoteSilentUpdate` stays readable in `settings.json` and older builds may still write the removed `state.json` keys; this build ignores them (on-disk N-2 rule).

## Alternatives considered

Keeping the browser "Restart to update" button by turning `--supervise` into a hidden command was rejected: it would still install upstream builds. A settings toggle defaulting off was rejected for the same reason — the code would remain one click from overwriting the fork.
