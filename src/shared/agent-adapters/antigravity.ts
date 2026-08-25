/** Google Antigravity CLI adapter. */
import { GENERIC_SKILL_BODY } from "../agent-skill-content";
import { modelArgs, providerArgs } from "./common";
import { shellEscape } from "./shell";
import { buildTaskPrompt } from "./template";
import type { AgentAdapter } from "./types";

function permissionArgs(permissionMode: string | undefined): string[] {
	switch (permissionMode) {
		case "acceptEdits":
			return ["--mode", "accept-edits"];
		case "plan":
			return ["--mode", "plan"];
		case "bypassPermissions":
		case "dontAsk":
			return ["--dangerously-skip-permissions"];
		default:
			return [];
	}
}

export const antigravityAdapter: AgentAdapter = {
	command: "agy",
	supportsResume: true,
	supportsPreAssignedSessionId: false,
	// Antigravity discovers dev3 through the shared ~/.agents skill and rule files.
	skillBody: GENERIC_SKILL_BODY,
	trustKinds: ["claude"],

	launchArgs(baseCmd, config, ctx, options) {
		const args: string[] = [];
		const resume = options?.resume ?? false;

		if (resume) {
			if (options?.sessionId) args.push("--conversation", options.sessionId);
			else args.push("--continue");
		}

		args.push(...modelArgs(config, options));
		args.push(...providerArgs(options));
		args.push(...permissionArgs(config?.permissionMode));

		if (config?.effort) {
			// Antigravity tops out at high; dev3's shared type also includes xhigh.
			args.push("--effort", config.effort === "xhigh" ? "high" : config.effort);
		}

		if (config?.additionalArgs) args.push(...config.additionalArgs);

		if (!resume) {
			const prompt = buildTaskPrompt(config?.appendPrompt, ctx);
			if (prompt) args.push("--prompt-interactive", shellEscape(prompt));
		}

		return [baseCmd, ...args];
	},

	buildResumeCommand(baseCmd, sessionId) {
		return sessionId ? `${baseCmd} --conversation ${sessionId}` : `${baseCmd} --continue`;
	},

	hooksSpec() {
		return null;
	},
};
