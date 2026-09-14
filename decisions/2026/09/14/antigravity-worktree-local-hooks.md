# Antigravity status hooks: worktree-local `.agents/hooks.json`

## Context

`antigravityAdapter.hooksSpec()` returned `null`, so Antigravity (`agy`) tasks
never moved between board columns on their own — every other first-class agent
(Claude, Codex, Copilot) already has automatic status hooks. `agy` reads hook
config from `hooks.json`, auto-discovered at `<workspace>/.agents/hooks.json`
in addition to the global `~/.gemini/config/hooks.json`, but only when the
workspace is in the `trustedWorkspaces` array of
`~/.gemini/antigravity-cli/settings.json`.

## Investigation

`agy`'s bundled docs/changelog confirm: a top-level object keyed by hook name;
`PreInvocation`/`Stop` are flat handler lists (unlike `PreToolUse`/`PostToolUse`,
which use `{matcher, hooks}` groups); handlers run via `sh -c`/`cmd /c`,
cwd = the hooks.json directory, `~` expanded, 30s default timeout. `Stop`
carries `fullyIdle` — an intermediate stop mid-plan is not a real turn end, so
only `fullyIdle !== false` should move the task. There is no event for
"waiting on permission approval", so unlike Claude/Codex an approval prompt
cannot move the task to `user-questions`.

## Decision

Worktree-local hooks, written per task launch — same shape as Codex's
`.codex/hooks.json` and Copilot's `.github/hooks/dev3.json`:

- `buildAntigravityHooks`/`writeAntigravityHooks` (`src/shared/agent-hooks.ts`)
  generate and merge a single `"dev3"` named hook with `PreInvocation`/`Stop`
  handlers calling `dev3 hook antigravity --event <E>`; every other named hook
  in the file is preserved, and malformed/non-object content throws rather
  than being overwritten (same contract as `writeCopilotHooks`).
- `ensureAntigravityTrust` (`src/bun/agents.ts`) registers the worktree's
  realpath into `trustedWorkspaces` in
  `~/.gemini/antigravity-cli/settings.json`, preserving other keys (e.g.
  `colorScheme`); wired into the shared trust loop in
  `src/bun/rpc-handlers/tmux-pty.ts` via `antigravityAdapter.trustKinds`.
  `forgetWorktreeTrust`/`sweepStaleWorktreeTrust` in `src/bun/worktree-trust.ts`
  prune stale entries the same way they already do for Gemini/Codex/Claude.
- `dev3 hook antigravity --event <E>` (`src/cli/commands/antigravity-hook.ts`)
  maps `PreInvocation` → `task.agentHook`'s `UserPromptSubmit` and `Stop` →
  `Stop` (skipped when `fullyIdle === false`) — no server-side change needed,
  `task.agentHook` already accepts the Codex event vocabulary and
  `getCodexHookTargetStatus` already covers auto-review routing.
- `resolveCopilotHookCliPath` was renamed to `resolveHookCliPath`
  (`src/shared/dev3-cli-path.ts`) since it is no longer Copilot-specific.

## Risks

- No permission-approval event means a task can sit at `in-progress` while the
  user is actually blocked on an agy approval dialog; documented as a known
  gap in `agent-support-matrix.md` rather than worked around.
- The workspace-local file loads only when trusted, so a first launch that
  fails to write the trust entry silently gets no hooks (same failure class
  Codex already tolerates — logged, non-fatal, not blocking).

## Alternatives considered

- **Global `~/.agents/hooks.json`**: rejected — it would fire the guard-less
  `dev3 hook antigravity` in every `agy` session on the machine, not just dev3
  tasks (the same problem Codex hooks solve with a `DEV3_TASK_ID` env guard;
  a worktree-local file needs no such guard at all).
- **A wrapper directory passed via `--add-dir`**: rejected as unnecessary
  indirection — `agy` already discovers `.agents/hooks.json` at the workspace
  root once trusted, so no extra launch flag or directory shim is needed.
