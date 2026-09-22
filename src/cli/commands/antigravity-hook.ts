import { ANTIGRAVITY_STATUS_HOOK_EVENTS, type AntigravityStatusHookEvent, type AgentStatusHookEvent } from "../../shared/agent-hooks";
import type { CliContext } from "../context";
import { sendRequest } from "../socket-client";

const ALLOW_JSON = "{}";
const STOP_ALLOW_JSON = JSON.stringify({ decision: "allow" });

function isSupportedEvent(event: string | undefined): event is AntigravityStatusHookEvent {
	return ANTIGRAVITY_STATUS_HOOK_EVENTS.includes(event as AntigravityStatusHookEvent);
}

/**
 * `task.agentHook` speaks the Codex event vocabulary — agy's own two events map
 * onto the two Codex events that drive the same transitions: a fresh
 * invocation starting work looks exactly like a submitted prompt, and a
 * finished turn looks exactly like Codex's `Stop`.
 */
function toAgentEvent(event: AntigravityStatusHookEvent): AgentStatusHookEvent {
	return event === "PreInvocation" ? "UserPromptSubmit" : "Stop";
}

/**
 * Internal Antigravity (`agy`) lifecycle adapter, invoked as
 * `dev3 hook antigravity --event <PreInvocation|Stop>` from the worktree-local
 * `.agents/hooks.json`. Must always emit valid JSON and exit 0: agy blocks its
 * agent loop on a hook, and board synchronization must never be the reason a
 * turn stalls or a stop is refused.
 *
 * `Stop` maps straight onto Codex's `Stop` via the shared `task.agentHook`
 * handler — agy's `fullyIdle` distinguishes a genuine turn end from an
 * intermediate stop still expecting more steps, so only the former moves the
 * task.
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

	let fullyIdle: boolean | undefined;
	try {
		const parsed = JSON.parse(rawInput);
		if (parsed && typeof parsed === "object" && typeof parsed.fullyIdle === "boolean") {
			fullyIdle = parsed.fullyIdle;
		}
	} catch {
		// Malformed stdin still gets a valid response below — never block agy.
	}

	const successJson = event === "Stop" ? STOP_ALLOW_JSON : ALLOW_JSON;

	// An intermediate Stop (more steps queued) is not a real turn end.
	if (event === "Stop" && fullyIdle === false) {
		process.stdout.write(successJson);
		return;
	}

	if (socketPath && context?.taskId) {
		try {
			const result = await sendRequest(socketPath, "task.agentHook", {
				taskId: context.taskId,
				projectId: context.projectId,
				event: toAgentEvent(event),
			}, { timeoutMs: 3_000, connectAttempts: 2, retryDelayMs: 50 });
			if (!result.ok) process.stderr.write(`dev3 Antigravity hook: ${result.error || "status update failed"}\n`);
		} catch (error) {
			process.stderr.write(`dev3 Antigravity hook: ${error instanceof Error ? error.message : String(error)}\n`);
		}
	}

	process.stdout.write(successJson);
}
