import type { AgentStatusHookEvent } from "../../shared/agent-hooks";

/**
 * agy runs subagents inside the same process and fires the workspace hooks for
 * them too, each with its own conversation id and nothing in the payload naming
 * the parent. Observed on agy 1.4.5: a subagent only ever starts while the main
 * conversation is mid-turn, and every hook's parent process is the agy process.
 * So per agy process, the first conversation seen is the main one; a different
 * conversation while the main one is busy is a subagent; a different one while
 * it is idle is a new main conversation (`/new`).
 * See decisions/2026/10/22/antigravity-session-start-hook.md.
 */
export type AntigravityConversationRole = "main" | "subagent";

interface ProcessState {
	mainId: string;
	busy: boolean;
}

const MAX_TRACKED_PROCESSES = 256;
const processes = new Map<string, ProcessState>();

export function classifyAntigravityConversation(
	processKey: string,
	conversationId: string,
	event: AgentStatusHookEvent,
): AntigravityConversationRole {
	let state = processes.get(processKey);
	if (state && state.mainId !== conversationId) {
		if (state.busy) return "subagent";
		state = undefined;
	}
	if (!state) {
		state = { mainId: conversationId, busy: false };
		if (processes.size >= MAX_TRACKED_PROCESSES) {
			processes.delete(processes.keys().next().value as string);
		}
		processes.set(processKey, state);
	}
	if (event === "UserPromptSubmit") state.busy = true;
	else if (event === "Stop" || event === "SessionStart") state.busy = false;
	return "main";
}

export function _resetAntigravityConversationsForTests(): void {
	processes.clear();
}
