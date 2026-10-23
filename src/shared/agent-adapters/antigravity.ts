/** Google Antigravity CLI adapter. */
import { GENERIC_SKILL_BODY } from "../agent-skill-content";
import { modelArgs, providerArgs, slashExitProgram } from "./common";
import { shellEscape } from "./shell";
import { buildTaskPrompt } from "./template";
import type { AgentAdapter } from "./types";

function permissionArgs(permissionMode: string | undefined): string[] {
	switch (permissionMode) {
		case "acceptEdits":
			return ["--mode", "accept-edits"];
		case "plan":
			return ["--mode", "plan"];
		case "auto":
			return ["--mode", "auto"];
		case "bypassPermissions":
		case "dontAsk":
			return ["--dangerously-skip-permissions"];
		default:
			return [];
	}
}

/** `agy models` prints one `<slug>\t<display name>` line per selectable model;
 *  its "Fetching…" banner goes to stderr. */
export function parseAntigravityModels(stdout: string): string[] | null {
	const slugs = stdout
		.split("\n")
		.map((line) => line.split("\t"))
		.filter((cols) => cols.length >= 2 && cols[0].trim() && !/\s/.test(cols[0].trim()))
		.map((cols) => cols[0].trim());
	return slugs.length ? slugs : null;
}

export const antigravityAdapter: AgentAdapter = {
	command: "agy",
	supportsResume: true,
	supportsPreAssignedSessionId: false,
	// Delivered as a SessionStart system message by `dev3 hook antigravity`, and
	// as the `dev3` skill under ~/.gemini/config/skills for sessions dev3 did not start.
	skillBody: GENERIC_SKILL_BODY,
	trustKinds: ["claude", "antigravity"],
	modelListProbe: {
		args: ["models"],
		timeoutMs: 8000,
		parse: parseAntigravityModels,
	},

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

		if (config?.effort) args.push("--effort", config.effort);

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

	// agy documents both `/exit` and `/quit`; not yet observed against a live CLI.
	exitProgram() {
		return slashExitProgram("/quit");
	},

	hooksSpec() {
		return { kind: "antigravity" };
	},
};
