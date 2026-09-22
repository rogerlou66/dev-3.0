# Copilot lifecycle hook isolation

Superseded on 2026-09-22 by `decisions/2026/09/22/upstream-v1-54-integration-preserves-fork.md`: Copilot now uses upstream's lifecycle hooks and session-start protocol injection; the fork-only environment and worktree hook path are removed.

## Context

GitHub Copilot CLI reads native hooks and repository Claude settings together. Unmodified dev3 Claude hooks would therefore also run in Copilot, duplicating status changes and treating Copilot permission-service events as user attention even when permission is already granted.

## Investigation

The [official hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) documents `.github/hooks/*.json`, cross-tool Claude settings, direct executable hooks with environment overrides, and separate `agentStop`, `subagentStop`, and `sessionEnd` events. Copilot's native camelCase payloads do not carry an event-name field, so each generated hook supplies its event through an explicit CLI argument. Native UI QA found that the protected shared CLI can predate `hook copilot`, leaving successful turns without board transitions.

## Decision

`buildCopilotHooks` in `src/shared/agent-hooks.ts` installs only `userPromptSubmitted` and `agentStop`; `handleCopilotHook` in `src/cli/commands/copilot-hook.ts` validates the payload and reuses the existing atomic `task.agentHook` transition without Codex session-capture metadata. Generated Claude commands carry the internal `--claude-hook` marker, which `src/cli/main.ts` strips or skips when `DEV3_COPILOT_SESSION=1`; Copilot installation tags existing dev3 commands in both Claude settings files while preserving user hooks. Copilot hook installation resolves the running headless CLI or current app-bundled CLI before the source-built and shared fallbacks, and sets `DEV3_HOME` in each hook to the launching app's data root. This new hook path does not change the frozen POSIX invocation or install over the shared CLI.

## Risks

Hooks require the current dev3 CLI and a managed Copilot launch environment; deleting its app bundle can invalidate generated hooks until the next managed launch refreshes them. Source execution without a built CLI retains the shared fallback, which may lack the new subcommand. User hooks can independently alter or block Copilot behavior; malformed existing configuration is reported rather than overwritten, and failed board synchronization returns successful empty JSON so it cannot block the agent.

## Alternatives considered

Deleting Claude hooks would break Claude review agents sharing the worktree. Disabling all cross-tool or user hooks would remove user controls; using `sessionEnd` as completion would incorrectly classify exits and failures, while forwarding Copilot session IDs through the Codex capture path would corrupt recovery metadata.
