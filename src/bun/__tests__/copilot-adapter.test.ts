import { describe, expect, it, vi, afterEach } from "vitest";
import { copilotAdapter } from "../../shared/agent-adapters/copilot";
import { getAgentAdapter } from "../../shared/agent-adapters/registry";
import { DEFAULT_AGENTS } from "../../shared/types";
import { shellEscape } from "../../shared/agent-adapters/shell";

const ctx = { taskTitle: "Test", taskDescription: "Fix it", projectName: "p", projectPath: "/p", worktreePath: "/p/task" };
const id = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.restoreAllMocks());

describe("Copilot task launch", () => {
	it("registers the CLI and wrapper family", () => {
		expect(getAgentAdapter("/opt/homebrew/bin/copilot")).toBe(copilotAdapter);
		expect(getAgentAdapter("wrapper", "copilot")).toBe(copilotAdapter);
	});
	it("offers bypass first without pinning a model", () => {
		const agent = DEFAULT_AGENTS.find(a => a.id === "builtin-copilot")!;
		expect(agent.defaultConfigId).toBe("copilot-bypass");
		expect(agent.configurations.map(c => c.permissionMode)).toEqual(["bypassPermissions", "default", "plan"]);
		for (const config of agent.configurations) {
			expect(config.model).toBeUndefined();
			const args = copilotAdapter.launchArgs("copilot", config, ctx, { sessionId: id });
			expect(args).toContain("--interactive");
			expect(args).not.toContain("--prompt");
			expect(args.includes("--allow-all")).toBe(config.permissionMode === "bypassPermissions");
			expect(args.includes("--plan")).toBe(config.permissionMode === "plan");
		}
	});
	it.each(["darwin", "linux", "win32"])("quotes prompts in the %s launch dialect", platform => {
		vi.spyOn(process, "platform", "get").mockReturnValue(platform as NodeJS.Platform);
		const prompt = "\u4fee\u590d\u767b\u5f55\nIt's \"quoted\"; $(touch NEVER) `echo nope`";
		const config = { id: "c", name: "C", model: "my model", appendPrompt: "Project: {{PROJECT_NAME}}" };
		const args = copilotAdapter.launchArgs("copilot", config, { ...ctx, taskDescription: prompt }, { sessionId: id });
		expect(args).toEqual(["copilot", "--session-id", shellEscape(id), "--model", shellEscape("my model"), "--interactive", shellEscape(`${prompt}\n\nProject: p`)]);
	});
	it("resumes only the specified task and never replays its original prompt", () => {
		const args = copilotAdapter.launchArgs("copilot", undefined, ctx, { resume: true, sessionId: id });
		expect(args).toEqual(["copilot", shellEscape(`--resume=${id}`)]);
		expect(copilotAdapter.buildResumeCommand("copilot", id)).toBe(args.join(" "));
		expect(() => copilotAdapter.launchArgs("copilot", undefined, ctx, { resume: true })).toThrow("session ID is missing");
		expect(() => copilotAdapter.buildResumeCommand("copilot")).toThrow("session ID is missing");
	});
	it("opens an empty interactive session without submitting a prompt", () => {
		expect(copilotAdapter.launchArgs("copilot", undefined, { ...ctx, taskDescription: "" })).toEqual(["copilot"]);
	});
	it("rejects unsupported preset controls instead of promising ineffective constraints", () => {
		expect(() => copilotAdapter.launchArgs("copilot", { id: "c", name: "C", maxBudgetUsd: 1 }, ctx)).toThrow("budget");
		expect(() => copilotAdapter.launchArgs("copilot", { id: "c", name: "C", permissionMode: "acceptEdits" }, ctx)).toThrow("permissions");
	});
});
