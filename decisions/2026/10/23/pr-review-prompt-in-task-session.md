# PR Review prompt goes into the task's own session, pinned in memory

## Context
PR #4 started a separate column agent when a card entered PR Review. The user wanted the task's own agent to receive a prompt instead, keeping one conversation with full context. #4 was reverted, and `Project.prReviewPrompt` replaces it.

## Investigation
The prompt is typed through `deliverAgentPrompt`, the same path `dev3 message` and the Create PR hand-off use. The turn it starts fires the primary agent's normal status hooks, which move the card to Agent is Working and then Your Review. #4's env-var pin cannot help here because the primary agent is already running, so its environment cannot change.

## Decision
`injectPrReviewPrompt` (`src/bun/lifecycle/executor.ts`) pins the task (`src/bun/pr-review-turn-pin.ts`) before typing. While the pin holds, the task's own `task.move` to in-progress / review-by-user / user-questions (`cli-socket/task-commands.ts`, matched by `sourceTaskId === task.id`) and every `task.agentHook` move (`cli-socket/agent-commands.ts`) become no-ops. The turn's end releases the pin: a review-by-user move (Claude's Stop), Stop/Interrupt/SessionEnd, or StopFailure. It also drops when the card leaves PR Review, or after 2 hours.

## Risks
The pin lives in app memory, so a restart mid-turn lets the card move as usual. If the agent was busy when the card moved, the earlier turn's Stop releases the pin and the injected turn moves the card normally. A permission prompt during the pinned turn does not move the card to Has Questions.

## Alternatives considered
Keeping #4's agent behind a mode switch was declined by the user. Adding review-by-colleague to the hooks' `--if-status-not` guard would freeze the card for every later feedback turn too, and would need a hooks rewrite in each worktree.
