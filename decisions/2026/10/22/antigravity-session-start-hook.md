# Antigravity: protocol, notes and exact resume through `SessionStart`

## Context

Antigravity (`agy`) tasks got the dev3 protocol only if the model chose to open the
`dev3` skill. agy reads `GEMINI.md`/`AGENTS.md` only from the working directory up to the
repo root, so `~/.agents/AGENTS.md` never reaches it. Resume used `--continue` because
dev3 never learned the conversation id, and agy has no launch-time id flag.

## Investigation

agy 1.4.5's bundled docs (`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`)
document a `SessionStart` hook that can answer
`{"injectSteps":[{"systemMessage":{"systemMessage":"…"}}]}`, and every payload carries
`conversationId`. The following was probed against a live agy 1.4.5 in a trusted
scratch workspace:

- `SessionStart` fires for a fresh conversation. The injected message reaches the model,
  including the full ~29 KB protocol.
- It does **not** fire on `--conversation <id>` resume, so nothing is injected twice.
- **Subagents fire every hook** (`SessionStart`, `PreInvocation`, `Stop` with
  `fullyIdle: true`) under their own conversation id. Nothing in the payload or the
  environment (`ANTIGRAVITY_CONVERSATION_ID` is the subagent's own id) names the parent.
- Every hook's direct parent process is the agy process itself, shared by the main
  conversation and its subagents. A subagent only starts while the main conversation is
  mid-turn, between its `PreInvocation` and its final `Stop`.

## Decision

- `buildAntigravityHooks` (`src/shared/agent-hooks.ts`) adds a `SessionStart` handler.
  `handleAntigravityHook` (`src/cli/commands/antigravity-hook.ts`) reports every event
  with `harness: "agy"`, the `conversationId` as `sessionId`, the pane id, and the agy
  pid (`process.ppid`). It answers `SessionStart` with `GENERIC_SKILL_BODY` plus the
  recent-notes block. Offline, it still injects the protocol.
- `classifyAntigravityConversation` (`src/bun/cli-socket/antigravity-conversations.ts`)
  keeps in-memory state per task and agy pid. The first conversation seen is the main
  one. A different conversation while the main one is busy is a subagent. A different
  conversation while the main one is idle becomes the new main one (`/new`). `task.agentHook`
  returns `{ ignoredSubagent: true }` for a subagent, so it does not move the task, record
  a session id, or get the protocol. This also fixes a subagent's `Stop` moving the task to
  review (and starting auto-review) mid-turn.
- The main conversation's id goes through `capturePaneSession`. Resume then uses
  `--conversation <id>`. Without an agy pid (Windows, where the parent is a per-hook
  `cmd /c`), nothing is recorded and subagents are not filtered.
- Adapter: `auto` → `--mode auto` (with an "Auto" preset); `xhigh` is passed through;
  `agy models` is the model probe; quit is `/quit`. The coordinator and artifact skills
  are installed under `~/.gemini/config/skills/`.

## Risks

- The state is in memory. If the app restarts while a subagent runs, that agy process's
  next event decides which conversation is the main one, and it could be the subagent's.
  This heals at the next idle `SessionStart`.
- If the main conversation ever ended a turn without a `Stop` hook, a later `/new`
  conversation would be misread as a subagent until agy restarts. agy documents
  `USER_CANCELED` as a `Stop` reason, so Esc still fires it.
- `--mode auto` is not offered to every account; agy warns and falls back to default mode.

## Alternatives considered

- **Capture only on `SessionStart`**: rejected after the probe showed that subagents fire
  it too.
- **Look up the parent in agy's files**: rejected. When `SessionStart` fires, the
  subagent's transcript holds only the injected step, and the parent link appears only
  later.
- **A rule file in the worktree**: rejected. It dirties the repository and is capped at
  24 KB per file.
