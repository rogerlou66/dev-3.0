import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERIC_SKILL_BODY } from "../shared/agent-skill-content";
import { DEV3_HOME } from "./paths";

/** A launch-only instruction source; user and repository configuration stay intact. */
export function applyCopilotLaunchEnv(
	env: Record<string, string>,
	skipSystemPrompt = false,
	root = DEV3_HOME,
	inheritedDirs = process.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS,
): void {
	env.DEV3_COPILOT_SESSION = "1";
	if (skipSystemPrompt) return;
	const dir = join(root, "data", "agent-prompts", "copilot");
	const path = join(dir, "AGENTS.md");
	mkdirSync(dir, { recursive: true });
	let current: string | undefined;
	try { current = readFileSync(path, "utf-8"); } catch { /* First launch. */ }
	if (current !== GENERIC_SKILL_BODY) writeFileSync(path, GENERIC_SKILL_BODY, "utf-8");
	const existing = env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS ?? inheritedDirs ?? "";
	env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS = [...new Set([...existing.split(",").filter(Boolean), dir])].join(",");
}
