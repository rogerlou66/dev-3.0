# Copilot lifecycle hook isolation

## Context

GitHub Copilot CLI reads native hooks and repository Claude settings together. Unmodified dev3 Claude hooks would therefore also run in Copilot, duplicating status changes and treating Copilot permission-service events as user attention even when permission is already granted.

## Investigation

The [official hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) documents `.github/hooks/*.json`, cross-tool Claude settings, direct executable command hooks, and separate `agentStop`, `subagentStop`, and `sessionEnd` events. Copilot's native camelCase payloads do not carry an event-name field, so each generated hook supplies its event through an explicit CLI argument.

## Decision

`buildCopilotHooks` in `src/shared/agent-hooks.ts` installs only `userPromptSubmitted` and `agentStop`; `handleCopilotHook` in `src/cli/commands/copilot-hook.ts` validates the payload and reuses the existing atomic `task.agentHook` transition without Codex session-capture metadata. Generated Claude commands carry the internal `--claude-hook` marker, which `src/cli/main.ts` strips or skips when `DEV3_COPILOT_SESSION=1`; Copilot installation tags existing dev3 commands in both Claude settings files while preserving user hooks.

## Risks

Hooks require the current dev3 CLI and a managed Copilot launch environment. User hooks can independently alter or block Copilot behavior; malformed existing configuration is reported rather than overwritten, and failed board synchronization returns successful empty JSON so it cannot block the agent.

## Alternatives considered

Deleting Claude hooks would break Claude review agents sharing the worktree. Disabling all cross-tool or user hooks would remove user controls; using `sessionEnd` as completion would incorrectly classify exits and failures, while forwarding Copilot session IDs through the Codex capture path would corrupt recovery metadata.
