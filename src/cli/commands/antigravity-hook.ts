import { ANTIGRAVITY_STATUS_HOOK_EVENTS, type AntigravityStatusHookEvent, type AgentStatusHookEvent } from "../../shared/agent-hooks";
import { GENERIC_SKILL_BODY } from "../../shared/agent-skill-content";
import type { CliContext } from "../context";
import { sendRequest } from "../socket-client";
import { columnAgentPinParams } from "../column-agent-pin";
import { loadRecentNotesBlock } from "./recent-notes";

const ALLOW_JSON = "{}";
const STOP_ALLOW_JSON = JSON.stringify({ decision: "allow" });

interface AntigravityHookPayload {
	fullyIdle?: boolean;
	conversationId?: string;
}

function isSupportedEvent(event: string | undefined): event is AntigravityStatusHookEvent {
	return ANTIGRAVITY_STATUS_HOOK_EVENTS.includes(event as AntigravityStatusHookEvent);
}

function parsePayload(rawInput: string): AntigravityHookPayload {
	try {
		const parsed = JSON.parse(rawInput) as { fullyIdle?: unknown; conversationId?: unknown } | null;
		if (!parsed || typeof parsed !== "object") return {};
		return {
			...(typeof parsed.fullyIdle === "boolean" ? { fullyIdle: parsed.fullyIdle } : {}),
			...(typeof parsed.conversationId === "string" && parsed.conversationId
				? { conversationId: parsed.conversationId }
				: {}),
		};
	} catch {
		// Malformed stdin still gets a valid response — never block agy.
		return {};
	}
}

/**
 * `task.agentHook` speaks the Codex event vocabulary — agy's events map onto the
 * Codex events that drive the same transitions: a fresh invocation starting work
 * looks exactly like a submitted prompt, and a finished turn like Codex's `Stop`.
 */
function toAgentEvent(event: AntigravityStatusHookEvent): AgentStatusHookEvent {
	if (event === "PreInvocation") return "UserPromptSubmit";
	return event;
}

/** agy's SessionStart answer: the dev3 protocol, then the task's recent notes. */
export function antigravitySessionStartOutput(notesBlock: string | null): string {
	const systemMessage = notesBlock ? `${GENERIC_SKILL_BODY}\n\n${notesBlock}` : GENERIC_SKILL_BODY;
	return JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage } }] });
}

/**
 * Internal Antigravity (`agy`) lifecycle adapter, invoked as
 * `dev3 hook antigravity --event <SessionStart|PreInvocation|Stop>` from the
 * worktree-local `.agents/hooks.json`. Must always emit valid JSON and exit 0:
 * agy blocks its agent loop on a hook, and board synchronization must never be
 * the reason a turn stalls or a stop is refused.
 *
 * `SessionStart` is agy's only out-of-band instruction channel (it reads no
 * global rule file outside the repository), so it carries the protocol.
 * Subagents fire the same hooks with their own conversation ids; every event
 * reports its id plus the agy pid (this hook's parent on POSIX) so the app can
 * tell them apart, and a subagent gets no protocol.
 */
export async function handleAntigravityHook(
	event: string | undefined,
	rawInput: string,
	socketPath: string | null,
	context: CliContext | null,
): Promise<void> {
	if (!isSupportedEvent(event)) {
		process.stdout.write(ALLOW_JSON);
		return;
	}

	const payload = parsePayload(rawInput);
	const successJson = event === "Stop" ? STOP_ALLOW_JSON : ALLOW_JSON;

	// An intermediate Stop (more steps queued) is not a real turn end.
	if (event === "Stop" && payload.fullyIdle === false) {
		process.stdout.write(successJson);
		return;
	}

	const recentNotes = event === "SessionStart"
		? loadRecentNotesBlock(socketPath, context?.taskId, context?.projectId)
		: null;

	let subagent = false;
	if (socketPath && context?.taskId) {
		const sessionId = payload.conversationId;
		const paneId = process.env.TMUX_PANE?.trim() || process.env.DEV3_PANE_ID?.trim() || undefined;
		// On Windows the parent is a per-hook `cmd /c`, which identifies nothing.
		const agentPid = process.platform === "win32" ? undefined : process.ppid;
		try {
			const result = await sendRequest(socketPath, "task.agentHook", {
				taskId: context.taskId,
				projectId: context.projectId,
				event: toAgentEvent(event),
				harness: "agy",
				...(sessionId ? { sessionId } : {}),
				...(sessionId && agentPid ? { agentPid } : {}),
				...(sessionId && paneId ? { paneId } : {}),
				...columnAgentPinParams(),
			}, { timeoutMs: 3_000, connectAttempts: 2, retryDelayMs: 50 });
			if (!result.ok) process.stderr.write(`dev3 Antigravity hook: ${result.error || "status update failed"}\n`);
			subagent = result.ok && (result.data as { ignoredSubagent?: unknown } | undefined)?.ignoredSubagent === true;
		} catch (error) {
			process.stderr.write(`dev3 Antigravity hook: ${error instanceof Error ? error.message : String(error)}\n`);
		}
	}

	if (recentNotes && !subagent) {
		const notes = await recentNotes;
		process.stdout.write(antigravitySessionStartOutput(notes.kind === "block" ? notes.block : null));
		return;
	}
	process.stdout.write(successJson);
}
