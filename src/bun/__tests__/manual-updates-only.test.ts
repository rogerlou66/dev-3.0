import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const exists = (relative: string) => existsSync(fileURLToPath(new URL(relative, import.meta.url)));

// This fork never contacts a release feed: a build runs until it is rebuilt from source.
describe("the app has no updater", () => {
	it("ships no updater or self-update modules", () => {
		for (const path of [
			"../updater.ts",
			"../self-update.ts",
			"../self-update-watch.ts",
			"../windows-update/apply.ts",
			"../../shared/self-update.ts",
			"../../cli/commands/update.ts",
		]) {
			expect(exists(path), path).toBe(false);
		}
	});

	it("exposes no update RPC, push message or menu item", () => {
		const schema = read("../../shared/types/rpc-schema.ts");
		expect(schema).not.toMatch(/\b(checkForUpdate|downloadUpdate|applyUpdate|updateAvailable|updateDownloadProgress|updateCheckOutcome)\b/);
		expect(read("../../shared/application-menu.ts")).not.toMatch(/checkForUpdates|Check for Updates/);
	});

	it("never calls Electrobun's network updater", () => {
		for (const path of ["../index.ts", "../headless-entry.ts", "../app-version.ts", "../electrobun-platform.ts"]) {
			expect(read(path), path).not.toMatch(/Updater\.(checkForUpdate|downloadUpdate|applyUpdate|updateInfo)\b/);
		}
	});

	it("has no update channel or remote self-update setting", () => {
		expect(read("../../shared/types/global-settings.ts")).not.toMatch(/\b(updateChannel|remoteSilentUpdate)\b/);
	});

	it("has no `dev3 update` command", () => {
		expect(read("../../cli/main.ts")).not.toMatch(/command === "update"/);
	});
});
