import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../socket-client", () => ({ sendRequest: vi.fn() }));
import { sendRequest } from "../socket-client";
import { copilotHookEvent, handleCopilotHook } from "../commands/copilot-hook";

const context = { taskId: "task-1", projectId: "project-1", socketPath: "/tmp/dev3-test.sock" };
const payload = (extra: object) => JSON.stringify({ sessionId: "session-1", cwd: "/tmp/worktree", ...extra });
let stdout = "";
beforeEach(() => {
	vi.stubEnv("DEV3_COPILOT_SESSION", "1");
	stdout = "";
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
	vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	vi.mocked(sendRequest).mockReset().mockResolvedValue({ id: "1", ok: true, data: {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Copilot lifecycle handler", () => {
	it("maps prompts and normal primary stops only", () => {
		expect(copilotHookEvent("userPromptSubmitted", payload({ prompt: "Continue" }))).toBe("UserPromptSubmit");
		expect(copilotHookEvent("agentStop", payload({ stopReason: "end_turn" }))).toBe("Stop");
		for (const event of ["sessionEnd", "subagentStop", "errorOccurred"]) {
			expect(copilotHookEvent(event, payload({ stopReason: "end_turn" }))).toBeNull();
		}
		for (const reason of ["error", "abort", "user_exit", undefined]) {
			expect(copilotHookEvent("agentStop", payload({ stopReason: reason }))).toBeNull();
		}
		expect(copilotHookEvent("agentStop", "invalid")).toBeNull();
	});
	it("forwards one atomic transition without storing Copilot ids as Codex sessions", async () => {
		await handleCopilotHook("agentStop", payload({ stopReason: "end_turn" }), context.socketPath, context);
		expect(sendRequest).toHaveBeenCalledTimes(1);
		expect(sendRequest).toHaveBeenCalledWith(context.socketPath, "task.agentHook", {
			taskId: "task-1", projectId: "project-1", event: "Stop",
		}, { timeoutMs: 3_000, connectAttempts: 2, retryDelayMs: 50 });
		expect(stdout).toBe("{}");
	});
	it("isolates concurrent task targets", async () => {
		await handleCopilotHook("userPromptSubmitted", payload({ prompt: "A" }), context.socketPath, context);
		await handleCopilotHook("userPromptSubmitted", payload({ prompt: "B" }), context.socketPath, { ...context, taskId: "task-2" });
		expect(vi.mocked(sendRequest).mock.calls.map((call) => call[2]?.taskId)).toEqual(["task-1", "task-2"]);
	});
	it("ignores hooks outside a managed Copilot session", async () => {
		vi.stubEnv("DEV3_COPILOT_SESSION", "0");
		await handleCopilotHook("agentStop", payload({ stopReason: "end_turn" }), context.socketPath, context);
		expect(sendRequest).not.toHaveBeenCalled();
		expect(stdout).toBe("{}");
	});
	it("returns successful JSON when offline or socket requests fail", async () => {
		await handleCopilotHook("agentStop", payload({ stopReason: "end_turn" }), null, context);
		vi.mocked(sendRequest).mockRejectedValue(new Error("offline"));
		await handleCopilotHook("agentStop", payload({ stopReason: "end_turn" }), context.socketPath, context);
		expect(stdout).toBe("{}{}");
	});
});
