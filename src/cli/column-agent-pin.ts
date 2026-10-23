import { COLUMN_AGENT_PIN_ENV } from "../shared/agent-hooks";

/** The column a column agent's status hooks must never move its card out of. */
export function columnAgentPinnedStatus(): string | null {
	return process.env[COLUMN_AGENT_PIN_ENV]?.trim() || null;
}

/** `--if-status-not` with the pinned column added, so a hook move from that agent is a no-op. */
export function withColumnAgentPin(ifStatusNot: string | undefined): string | undefined {
	const pinned = columnAgentPinnedStatus();
	if (!pinned) return ifStatusNot;
	return ifStatusNot ? `${ifStatusNot},${pinned}` : pinned;
}

/** The pin as a `task.agentHook` param; the app skips the status change when it matches. */
export function columnAgentPinParams(): { pinnedStatus?: string } {
	const pinned = columnAgentPinnedStatus();
	return pinned ? { pinnedStatus: pinned } : {};
}
