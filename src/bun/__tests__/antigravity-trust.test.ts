import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The settings path derives from process.env.HOME at import time.
let ensureAntigravityTrust: typeof import("../agents").ensureAntigravityTrust;
let SETTINGS: string;
let tmpHome: string;
let workspace: string;
let originalHome: string | undefined;

const read = () => JSON.parse(readFileSync(SETTINGS, "utf-8"));

beforeAll(async () => {
	originalHome = process.env.HOME;
	tmpHome = mkdtempSync(join(tmpdir(), "dev3-agy-trust-"));
	process.env.HOME = tmpHome;
	SETTINGS = (await import("../worktree-trust")).ANTIGRAVITY_TRUST_SETTINGS;
	ensureAntigravityTrust = (await import("../agents")).ensureAntigravityTrust;
	workspace = join(tmpHome, "work");
	mkdirSync(workspace, { recursive: true });
	workspace = realpathSync(workspace);
});

afterAll(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => rmSync(SETTINGS, { force: true }));

describe("ensureAntigravityTrust", () => {
	it("creates the settings file with trust and the alt screen enabled", async () => {
		await ensureAntigravityTrust(workspace);
		expect(read()).toEqual({ trustedWorkspaces: [workspace], altScreenMode: "always" });
	});

	it("upgrades the default mode and preserves other keys without duplicating trust", async () => {
		mkdirSync(join(tmpHome, ".gemini", "antigravity-cli"), { recursive: true });
		writeFileSync(SETTINGS, JSON.stringify({ colorScheme: "dark", altScreenMode: "default", trustedWorkspaces: [workspace] }));
		await ensureAntigravityTrust(workspace);
		expect(read()).toEqual({ colorScheme: "dark", altScreenMode: "always", trustedWorkspaces: [workspace] });
	});

	it("keeps an explicit user choice of mode", async () => {
		mkdirSync(join(tmpHome, ".gemini", "antigravity-cli"), { recursive: true });
		writeFileSync(SETTINGS, JSON.stringify({ altScreenMode: "inline" }));
		await ensureAntigravityTrust(workspace);
		expect(read()).toEqual({ altScreenMode: "inline", trustedWorkspaces: [workspace] });
	});
});
