import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	buildClaudeHooks, buildCopilotHooks, guardClaudeHooksFromCopilot,
	shouldSkipClaudeHook, writeCopilotHooks,
} from "../../shared/agent-hooks";

const dirs: string[] = [];
const temp = () => { const path = mkdtempSync(join(tmpdir(), "dev3-copilot-hooks-")); dirs.push(path); return path; };
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("Copilot hook installation", () => {
	it("uses native direct-executable hooks on Windows without shell quoting", () => {
		const config = buildCopilotHooks("C:\\Users\\Jane Doe\\dev3.exe") as any;
		expect(Object.keys(config.hooks)).toEqual(["userPromptSubmitted", "agentStop"]);
		expect(config.hooks.agentStop[0]).toEqual({ type: "command", exec: "C:\\Users\\Jane Doe\\dev3.exe", args: ["hook", "copilot", "--event", "agentStop"], timeoutSec: 5 });
	});

	it("preserves user hooks and settings and is idempotent", () => {
		const root = temp();
		mkdirSync(join(root, ".github", "hooks"), { recursive: true });
		mkdirSync(join(root, ".claude"));
		const hookPath = join(root, ".github", "hooks", "dev3.json");
		const claudePath = join(root, ".claude", "settings.local.json");
		const mine = { type: "command", bash: "echo user" };
		writeFileSync(hookPath, JSON.stringify({ version: 1, extra: true, hooks: { agentStop: [mine], sessionEnd: [mine] } }));
		writeFileSync(claudePath, JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo user" }, { type: "command", command: "~/.dev3.0/bin/dev3 task move --status review-by-user || [ $? -eq 2 ]" }] }] } }));
		expect(writeCopilotHooks(root)).toBe(true);
		const result = JSON.parse(readFileSync(hookPath, "utf8"));
		expect(result.extra).toBe(true);
		expect(result.hooks.agentStop).toHaveLength(2);
		expect(result.hooks.agentStop[0]).toEqual(mine);
		expect(result.hooks.sessionEnd).toEqual([mine]);
		const claude = JSON.parse(readFileSync(claudePath, "utf8"));
		expect(claude.permissions.allow).toEqual(["Bash(ls)"]);
		expect(claude.hooks.Stop[0].hooks[0].command).toBe("echo user");
		expect(claude.hooks.Stop[0].hooks[1].command).toContain("--claude-hook ||");
		expect(writeCopilotHooks(root)).toBe(false);
	});

	it("does not overwrite malformed user configuration", () => {
		const root = temp();
		mkdirSync(join(root, ".github", "hooks"), { recursive: true });
		const path = join(root, ".github", "hooks", "dev3.json");
		writeFileSync(path, "{broken");
		expect(() => writeCopilotHooks(root)).toThrow();
		expect(readFileSync(path, "utf8")).toBe("{broken");
	});

	it("replaces stale shared hooks with the current bundle and pins the app data root", () => {
		const root = temp();
		writeCopilotHooks(root);
		const options = { cliPath: "/Apps/dev3 dev.app/Contents/Resources/app/cli/dev3", dev3Home: "/tmp/dev3 qa" };
		expect(writeCopilotHooks(root, options)).toBe(true);
		const result = JSON.parse(readFileSync(join(root, ".github", "hooks", "dev3.json"), "utf8"));
		for (const event of ["agentStop", "userPromptSubmitted"]) {
			expect(result.hooks[event]).toHaveLength(1);
			expect(result.hooks[event][0].exec).toBe(options.cliPath);
			expect(result.hooks[event][0].env).toEqual({ DEV3_HOME: options.dev3Home });
		}
		expect(writeCopilotHooks(root, options)).toBe(false);
	});
});

describe("Claude cross-tool hook guard", () => {
	it("guards every newly generated Claude event including failures", () => {
		for (const groups of Object.values(buildClaudeHooks())) {
			for (const group of groups) for (const hook of group.hooks) expect(hook.command).toContain("--claude-hook");
		}
	});
	it("only skips explicitly tagged hooks in Copilot sessions", () => {
		expect(shouldSkipClaudeHook(["task", "move", "--claude-hook"], { DEV3_COPILOT_SESSION: "1" })).toBe(true);
		expect(shouldSkipClaudeHook(["task", "move"], { DEV3_COPILOT_SESSION: "1" })).toBe(false);
		expect(shouldSkipClaudeHook(["--claude-hook"], { DEV3_COPILOT_SESSION: "0" })).toBe(false);
	});
	it("preserves user hooks sharing a matcher group with dev3", () => {
		const settings = { hooks: { Stop: [{ hooks: [{ command: "echo user" }, { command: "~/.dev3.0/bin/dev3 task move --status review-by-user" }] }] } };
		const once = guardClaudeHooksFromCopilot(settings) as typeof settings;
		expect(once.hooks.Stop[0].hooks[0]).toEqual(settings.hooks.Stop[0].hooks[0]);
		expect(guardClaudeHooksFromCopilot(once)).toEqual(once);
	});
});
