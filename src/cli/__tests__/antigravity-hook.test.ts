import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../socket-client", () => ({ sendRequest: vi.fn() }));
import { sendRequest } from "../socket-client";
import { GENERIC_SKILL_BODY } from "../../shared/agent-skill-content";
import { handleAntigravityHook } from "../commands/antigravity-hook";

const context = { taskId: "task-1", projectId: "project-1", socketPath: "/tmp/dev3-test.sock" };
let stdout = "";
let stderr = "";
beforeEach(() => {
	stdout = "";
	stderr = "";
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
	vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr += String(chunk); return true; });
	vi.mocked(sendRequest).mockReset().mockResolvedValue({ id: "1", ok: true, data: {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function injectedSystemMessage(output: string): string {
	return JSON.parse(output).injectSteps[0].systemMessage.systemMessage;
}

describe("Antigravity lifecycle handler", () => {
	it("maps PreInvocation onto UserPromptSubmit", async () => {
		await handleAntigravityHook("PreInvocation", "{}", context.socketPath, context);
		expect(sendRequest).toHaveBeenCalledWith(context.socketPath, "task.agentHook", {
			taskId: "task-1", projectId: "project-1", event: "UserPromptSubmit", harness: "agy",
		}, { timeoutMs: 3_000, connectAttempts: 2, retryDelayMs: 50 });
		expect(stdout).toBe("{}");
	});

	it("maps a fully-idle Stop onto Stop and allows it", async () => {
		await handleAntigravityHook("Stop", JSON.stringify({ fullyIdle: true }), context.socketPath, context);
		expect(sendRequest).toHaveBeenCalledWith(context.socketPath, "task.agentHook", {
			taskId: "task-1", projectId: "project-1", event: "Stop", harness: "agy",
		}, { timeoutMs: 3_000, connectAttempts: 2, retryDelayMs: 50 });
		expect(stdout).toBe(JSON.stringify({ decision: "allow" }));
	});

	it("skips the status move on an intermediate stop (fullyIdle: false) but still allows it", async () => {
		await handleAntigravityHook("Stop", JSON.stringify({ fullyIdle: false }), context.socketPath, context);
		expect(sendRequest).not.toHaveBeenCalled();
		expect(stdout).toBe(JSON.stringify({ decision: "allow" }));
	});

	it("ignores unknown events but still returns valid JSON", async () => {
		await handleAntigravityHook("SomeFutureEvent", "{}", context.socketPath, context);
		expect(sendRequest).not.toHaveBeenCalled();
		expect(stdout).toBe("{}");
	});

	it("ignores malformed stdin without blocking the hook", async () => {
		await handleAntigravityHook("Stop", "not-json", context.socketPath, context);
		expect(sendRequest).toHaveBeenCalledTimes(1);
		expect(stdout).toBe(JSON.stringify({ decision: "allow" }));
	});

	it("never blocks when the app is offline", async () => {
		await handleAntigravityHook("Stop", JSON.stringify({ fullyIdle: true }), null, context);
		expect(sendRequest).not.toHaveBeenCalled();
		expect(stdout).toBe(JSON.stringify({ decision: "allow" }));
	});

	it("reports a socket error on stderr without failing the hook", async () => {
		vi.mocked(sendRequest).mockResolvedValue({ id: "1", ok: false, error: "status update failed" });
		await handleAntigravityHook("Stop", JSON.stringify({ fullyIdle: true }), context.socketPath, context);
		expect(stdout).toBe(JSON.stringify({ decision: "allow" }));
		expect(stderr).toContain("status update failed");
	});

	it("is a successful no-op outside a dev3 task", async () => {
		await handleAntigravityHook("PreInvocation", "{}", context.socketPath, null);
		expect(sendRequest).not.toHaveBeenCalled();
		expect(stdout).toBe("{}");
	});

	it("never reports a per-invocation conversation id (it may be a subagent's)", async () => {
		vi.stubEnv("TMUX_PANE", "%7");
		await handleAntigravityHook("PreInvocation", JSON.stringify({ conversationId: "sub-1" }), context.socketPath, context);
		expect(vi.mocked(sendRequest).mock.calls[0][2]).not.toHaveProperty("sessionId");
		expect(vi.mocked(sendRequest).mock.calls[0][2]).not.toHaveProperty("paneId");
	});

	it("reports SessionStart with the conversation id and pane, then injects protocol and notes", async () => {
		vi.stubEnv("TMUX_PANE", "%7");
		vi.mocked(sendRequest).mockImplementation(async (_socket, method) => (
			method === "note.list"
				? { id: "2", ok: true, data: [{ id: "n1", content: "Root cause lives in the parser", createdAt: "2026-10-20T10:00:00.000Z" }] }
				: { id: "1", ok: true, data: {} }
		));
		await handleAntigravityHook("SessionStart", JSON.stringify({ conversationId: "conv-1" }), context.socketPath, context);
		expect(sendRequest).toHaveBeenCalledWith(context.socketPath, "task.agentHook", {
			taskId: "task-1", projectId: "project-1", event: "SessionStart", harness: "agy", sessionId: "conv-1", paneId: "%7",
		}, { timeoutMs: 3_000, connectAttempts: 2, retryDelayMs: 50 });
		const message = injectedSystemMessage(stdout);
		expect(message.startsWith(GENERIC_SKILL_BODY)).toBe(true);
		expect(message).toContain("Root cause lives in the parser");
	});

	it("still injects the protocol on SessionStart when the app is offline", async () => {
		await handleAntigravityHook("SessionStart", "{}", null, context);
		expect(sendRequest).not.toHaveBeenCalled();
		expect(injectedSystemMessage(stdout)).toBe(GENERIC_SKILL_BODY);
	});
});
