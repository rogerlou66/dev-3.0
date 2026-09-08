import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCopilotLaunchEnv } from "../copilot-config";
import { GENERIC_SKILL_BODY } from "../../shared/agent-skill-content";

const roots: string[] = [];
function root() { const value = mkdtempSync(join(tmpdir(), "dev3-copilot-test-")); roots.push(value); return value; }
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
describe("Copilot launch instructions", () => {
	it("adds a managed source while retaining configured directories and unrelated environment", () => {
		const dir = root();
		const env: Record<string, string> = { COPILOT_CUSTOM_INSTRUCTIONS_DIRS: "/my/instructions", CUSTOM: "kept" };
		applyCopilotLaunchEnv(env, false, dir, "/inherited");
		const source = join(dir, "data", "agent-prompts", "copilot");
		expect(env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS).toBe(`/my/instructions,${source}`);
		expect(env.CUSTOM).toBe("kept");
		expect(env.DEV3_COPILOT_SESSION).toBe("1");
		expect(readFileSync(join(source, "AGENTS.md"), "utf8")).toBe(GENERIC_SKILL_BODY);
		const before = statSync(join(source, "AGENTS.md")).mtimeMs;
		applyCopilotLaunchEnv(env, false, dir);
		expect(env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS).toBe(`/my/instructions,${source}`);
		expect(statSync(join(source, "AGENTS.md")).mtimeMs).toBe(before);
	});
	it("preserves inherited directories and supports skipping protocol injection", () => {
		const env: Record<string, string> = {};
		applyCopilotLaunchEnv(env, false, root(), "/inherited");
		expect(env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS).toMatch(/^\/inherited,/);
		const skipped: Record<string, string> = {};
		applyCopilotLaunchEnv(skipped, true, root(), "/inherited");
		expect(skipped).toEqual({ DEV3_COPILOT_SESSION: "1" });
	});
});
