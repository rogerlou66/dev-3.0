/** GitHub Copilot CLI interactive sessions. */
import { GENERIC_SKILL_BODY } from "../agent-skill-content";
import { modelArgs } from "./common";
import { shellEscape } from "./shell";
import { buildTaskPrompt } from "./template";
import type { AgentAdapter } from "./types";

function resumeArgs(sessionId?: string): string[] {
	if (!sessionId) throw new Error("Copilot session ID is missing. Start a new session for this task.");
	return [shellEscape(`--resume=${sessionId}`)];
}

export const copilotAdapter: AgentAdapter = {
	command: "copilot",
	supportsResume: true,
	supportsPreAssignedSessionId: true,
	skillBody: GENERIC_SKILL_BODY,
	trustKinds: [],
	launchArgs(baseCmd, config, ctx, options) {
		const args: string[] = [];
		if (config?.permissionMode && !["default", "plan", "bypassPermissions"].includes(config.permissionMode)) {
			throw new Error("Copilot supports Default, Plan, and Bypass permissions. Update this preset in Settings.");
		}
		if (config?.maxBudgetUsd != null) throw new Error("Copilot does not support a dollar budget limit. Remove it from this preset.");
		if (options?.resume) args.push(...resumeArgs(options.sessionId));
		else if (options?.sessionId) args.push("--session-id", shellEscape(options.sessionId));
		args.push(...modelArgs(config, options));
		if (config?.effort) args.push("--effort", shellEscape(config.effort));
		if (config?.permissionMode === "bypassPermissions") args.push("--allow-all");
		if (config?.permissionMode === "plan") args.push("--plan");
		if (config?.additionalArgs) args.push(...config.additionalArgs);
		if (!options?.resume) {
			const prompt = buildTaskPrompt(config?.appendPrompt, ctx);
			if (prompt) args.push("--interactive", shellEscape(prompt));
		}
		return [baseCmd, ...args];
	},
	buildResumeCommand(baseCmd, sessionId) {
		return [baseCmd, ...resumeArgs(sessionId)].join(" ");
	},
	hooksSpec(options) {
		return { kind: "copilot", stopTarget: options?.stopTarget };
	},
};
