# Preserve fork workflows while merging v1.53.0

## Context

Integrate upstream release `v1.53.0` (`d2dc5912`) through local `main` into `rl-main` at `03dffbf9`. Backup branches preserve both original tips; a retained stash and a verified private archive preserve the preexisting uncommitted terminal extra-key changes and untracked files.

## Investigation

Sixteen files conflicted. Beyond textual conflicts, upstream artifact docking assumed a routed task, Agent traffic assumed a separate Questions column, and the Claude prompt-recording test omitted the fork's cross-tool hook marker.

## Decision

Keep the fork's Workspace Board, overlay/full-page/immersive presentations, additive Blocked holds, Android download bridge, Copilot/Antigravity adapters, CJK handling, and network policies. Route artifact visibility through the effective task and forward docking through overlays; keep delivery status alongside upstream human-message provenance in `sendAgentMessageNow`.

Map Questions into Working for traffic ordering, and project Blocked only for live cards: movement history cannot prove historical hold state. Keep `--claude-hook` on all generated Claude hooks so Copilot cannot execute them twice. Retain manual desktop updates and local traffic records without restoring analytics modules.

## Risks

Automated regression and browser checks do not prove every native Android device or physical macOS input method. Old app builds can overwrite globally installed skills at startup; application and CLI versions must remain aligned. No remote push or production installation is part of this merge.

## Alternatives considered

Taking either conflict side wholesale loses fork behavior or upstream fixes. Rebase would replay the fork's established merge history; a merge preserves ancestry and allows the exact upstream release to remain independently identifiable on `main`.
