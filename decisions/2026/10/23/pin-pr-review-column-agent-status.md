# Pin the PR Review column agent's card with an env var

## Context
The optional PR Review column agent runs in the task's worktree, so it shares the worktree's agent status hooks with the primary agent. In an end-to-end run its first prompt moved the card to Agent is Working and its Stop moved it to Your Review, pulling the card out of the column that launched it.

## Investigation
The hooks guard only `review-by-ai` (`buildClaudeHooks` in `src/shared/agent-hooks.ts`). The app cannot tell which agent a move came from: `dev3 task move` carries no caller identity, and `TMUX_PANE` is absent on the native backend.

## Decision
`launchColumnAgent` (`src/bun/rpc-handlers/tmux-pty/task-launch.ts`) exports `DEV3_COLUMN_AGENT_STATUS=review-by-colleague` into the PR Review agent's environment (`COLUMN_AGENT_PIN_ENV`). Hook processes inherit it. `dev3 task move` adds it to `--if-status-not`, and the `task.agentHook` senders pass it as `pinnedStatus`, which the handler in `src/bun/cli-socket/agent-commands.ts` treats as "no move". Both paths go through `src/cli/column-agent-pin.ts`. The primary agent never has the variable, so its moves out of PR Review are unchanged.

## Risks
Hooks call the managed CLI under `~/.dev3.0/bin`, so the pin takes effect only once that CLI is a build that contains this change. An older CLI ignores the variable and the card bounces, as it did before. AI Review deliberately gets no pin: its Stop hook is what hands the card back to Your Review.

## Alternatives considered
Adding `review-by-colleague` to the hooks' `--if-status-not` guard was rejected because it would also freeze the card while the primary agent addresses PR feedback, changing behavior for every user. A shell-level env check inside each generated hook command was rejected because it would touch every harness's hook text and both shell dialects.
