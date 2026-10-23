import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAntigravityHooks, writeAntigravityHooks } from "../../shared/agent-hooks";

const dirs: string[] = [];
const temp = () => { const path = mkdtempSync(join(tmpdir(), "dev3-antigravity-hooks-")); dirs.push(path); return path; };
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("buildAntigravityHooks", () => {
	it("builds a single named 'dev3' hook with SessionStart/PreInvocation/Stop as flat handler lists", () => {
		const hooks = buildAntigravityHooks() as any;
		expect(Object.keys(hooks)).toEqual(["dev3"]);
		expect(Object.keys(hooks.dev3)).toEqual(["SessionStart", "PreInvocation", "Stop"]);
		expect(hooks.dev3.SessionStart).toEqual([
			{ type: "command", command: "~/.dev3.0/bin/dev3 hook antigravity --event SessionStart", timeout: 10 },
		]);
		for (const event of ["PreInvocation", "Stop"]) {
			expect(hooks.dev3[event]).toEqual([
				{ type: "command", command: `~/.dev3.0/bin/dev3 hook antigravity --event ${event}`, timeout: 5 },
			]);
		}
	});

	it("quotes a raw cliPath containing spaces for a POSIX shell", () => {
		const hooks = buildAntigravityHooks("/Applications/dev3 dev.app/Contents/Resources/app/cli/dev3") as any;
		expect(hooks.dev3.Stop[0].command).toBe(
			"'/Applications/dev3 dev.app/Contents/Resources/app/cli/dev3' hook antigravity --event Stop",
		);
	});

	it("quotes a Windows cliPath and forces forward slashes", () => {
		const hooks = buildAntigravityHooks("C:\\Program Files\\dev3\\cli\\dev3.exe", { cli: "unused", posixShell: false }) as any;
		expect(hooks.dev3.PreInvocation[0].command).toBe(
			'"C:/Program Files/dev3/cli/dev3.exe" hook antigravity --event PreInvocation',
		);
	});
});

describe("writeAntigravityHooks", () => {
	it("creates .agents/hooks.json and is idempotent", () => {
		const root = temp();
		expect(writeAntigravityHooks(root)).toBe(true);
		const path = join(root, ".agents", "hooks.json");
		const first = JSON.parse(readFileSync(path, "utf8"));
		expect(first.dev3.Stop).toHaveLength(1);
		expect(writeAntigravityHooks(root)).toBe(false);
	});

	it("preserves other named hooks in the file, replacing only 'dev3'", () => {
		const root = temp();
		mkdirSync(join(root, ".agents"), { recursive: true });
		const path = join(root, ".agents", "hooks.json");
		const mine = { PreInvocation: [{ type: "command", command: "echo user" }] };
		writeFileSync(path, JSON.stringify({ "my-own-hook": mine, dev3: { PreInvocation: [{ type: "command", command: "stale" }] } }));
		expect(writeAntigravityHooks(root)).toBe(true);
		const result = JSON.parse(readFileSync(path, "utf8"));
		expect(result["my-own-hook"]).toEqual(mine);
		expect(result.dev3.PreInvocation[0].command).toBe("~/.dev3.0/bin/dev3 hook antigravity --event PreInvocation");
	});

	it("replaces a stale dev3 entry with the current bundle", () => {
		const root = temp();
		writeAntigravityHooks(root, { cliPath: "/old/dev3" });
		expect(writeAntigravityHooks(root, { cliPath: "/new/dev3" })).toBe(true);
		const result = JSON.parse(readFileSync(join(root, ".agents", "hooks.json"), "utf8"));
		expect(result.dev3.Stop[0].command).toContain("/new/dev3");
	});

	it("does not overwrite malformed user configuration", () => {
		const root = temp();
		mkdirSync(join(root, ".agents"), { recursive: true });
		const path = join(root, ".agents", "hooks.json");
		writeFileSync(path, "{broken");
		expect(() => writeAntigravityHooks(root)).toThrow();
		expect(readFileSync(path, "utf8")).toBe("{broken");
	});

	it("throws rather than overwrite a non-object file", () => {
		const root = temp();
		mkdirSync(join(root, ".agents"), { recursive: true });
		const path = join(root, ".agents", "hooks.json");
		writeFileSync(path, JSON.stringify(["not", "an", "object"]));
		expect(() => writeAntigravityHooks(root)).toThrow();
		expect(readFileSync(path, "utf8")).toBe(JSON.stringify(["not", "an", "object"]));
	});
});
