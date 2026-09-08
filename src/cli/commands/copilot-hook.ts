import { COPILOT_SESSION_ENV, type CopilotStatusHookEvent } from "../../shared/agent-hooks";
import type { CliContext } from "../context";
import { sendRequest } from "../socket-client";

export function copilotHookEvent(event: string | undefined, rawInput: string): "UserPromptSubmit" | "Stop" | null {
	try {
		const input = JSON.parse(rawInput);
		if (!input || typeof input !== "object" || typeof input.sessionId !== "string" || !input.sessionId) return null;
		if (event === "userPromptSubmitted" && typeof input.prompt === "string") return "UserPromptSubmit";
		if (event === "agentStop" && input.stopReason === "end_turn") return "Stop";
	} catch {
		return null;
	}
	return null;
}

/** Board synchronization is advisory; no payload or network failure may block Copilot. */
export async function handleCopilotHook(
	event: CopilotStatusHookEvent | string | undefined,
	rawInput: string,
	socketPath: string | null,
	context: CliContext | null,
): Promise<void> {
	const mapped = copilotHookEvent(event, rawInput);
	if (mapped && process.env[COPILOT_SESSION_ENV] === "1" && socketPath && context?.taskId) {
		try {
			const result = await sendRequest(socketPath, "task.agentHook", {
				taskId: context.taskId,
				projectId: context.projectId,
				event: mapped,
			}, { timeoutMs: 3_000, connectAttempts: 2, retryDelayMs: 50 });
			if (!result.ok) process.stderr.write(`dev3 Copilot hook: ${result.error || "status update failed"}\n`);
		} catch (error) {
			process.stderr.write(`dev3 Copilot hook: ${error instanceof Error ? error.message : String(error)}\n`);
		}
	}
	process.stdout.write("{}");
}
