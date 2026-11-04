import type { CliContext } from "./context";

/**
 * Our pane and pid, so the app can tell WHICH agent in the worktree ran this
 * command: replies and self-reminders go back to that agent, not a sibling. Only
 * from inside a worktree; the app decides whether an agent can be proven.
 */
export function senderAgentParams(context: CliContext | null): { sourcePaneId?: string; sourcePid?: number } {
	if (!context?.taskId) return {};
	const paneId = process.env.TMUX_PANE?.trim() || process.env.DEV3_PANE_ID?.trim();
	return paneId ? { sourcePaneId: paneId, sourcePid: process.pid } : {};
}
