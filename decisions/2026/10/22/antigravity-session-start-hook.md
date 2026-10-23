# Antigravity: protocol, notes and exact resume through `SessionStart`

## Context

Antigravity (`agy`) tasks got the dev3 protocol only if the model chose to open the
`dev3` skill. agy's rules come from `GEMINI.md`/`AGENTS.md` between the working
directory and the repo root, so `~/.agents/AGENTS.md` never reaches it. Resume used
`--continue` because dev3 never learned the conversation id, and agy has no launch-time
id flag.

## Investigation

agy 1.4.5's bundled docs (`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`)
document a `SessionStart` hook whose stdout may return
`{"injectSteps":[{"systemMessage":{"systemMessage":"…"}}]}`. Every hook payload
carries `conversationId`. The CLI now also accepts `--effort xhigh|max` and `--mode auto`,
and `agy models` prints `<slug>\t<name>` lines. A live probe of the hook payloads was
not run, so the details below come from the docs.

## Decision

- `buildAntigravityHooks` (`src/shared/agent-hooks.ts`) adds a `SessionStart` handler
  (10 s timeout). `handleAntigravityHook` (`src/cli/commands/antigravity-hook.ts`)
  reports it as `SessionStart` with harness `agy`, the `conversationId` as `sessionId`,
  and the pane id. It then answers with `GENERIC_SKILL_BODY` plus the recent-notes block
  as one `systemMessage`. The protocol is still injected when the app is offline.
- Only `SessionStart` carries the session id. `PreInvocation`/`Stop` may fire inside a
  subagent's own conversation, and recording that id would make resume open the subagent.
- `task.agentHook` accepts `harness: "agy"` (`PromptSubmitHarness`), so
  `capturePaneSession` records the id. The existing resume path then calls
  `--conversation <id>`.
- The adapter maps `auto` → `--mode auto`, passes `xhigh` through, probes `agy models`,
  and quits with `/quit`. A built-in "Auto" preset is added, and the dev3-coordinator,
  dev3-artifact and dev3-share-artifact skills are now installed under
  `~/.gemini/config/skills/`.

## Risks

- If agy fires `SessionStart` on `--conversation` resume, the protocol is injected a
  second time. That costs context but nothing breaks. Unverified.
- If subagents also fire `SessionStart`, a subagent id could overwrite the pane's id.
  Unverified; `PreInvocation` would have the same problem, and worse.
- An agy older than the `xhigh` effort level rejects that preset value; agy auto-updates.

## Alternatives considered

- **Write a rule file into the worktree** (`.agents/rules` or `AGENTS.md`): rejected.
  It dirties the user's repository and is capped by agy's 24 KB per-file rule limit.
- **Skip injection when `transcriptPath` already has content** (to avoid re-injecting on
  resume): rejected. Whether the file exists at `SessionStart` on a fresh launch is
  undocumented, and skipping a fresh session is worse than injecting twice.
