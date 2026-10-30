import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const exists = (relative: string) => existsSync(fileURLToPath(new URL(relative, import.meta.url)));

const mainSource = read("../index.ts");
const updaterSource = read("../updater.ts");
const headlessSource = read("../headless-entry.ts");
const cliMainSource = read("../../cli/main.ts");

describe("manual updates only", () => {
	it("does not schedule update checks from the main process", () => {
		expect(mainSource).not.toMatch(/startAutoCheck|Auto-Update Check/);
	});

	it("does not expose an automatic update scheduler", () => {
		expect(updaterSource).not.toMatch(/export function startAutoCheck|CHECK_INTERVAL_MS/);
	});
});

// A headless box runs what was built from source; it must never reach the release feed.
describe("headless dev3 remote has no updater", () => {
	it("starts no update watch and imports no updater", () => {
		expect(headlessSource).not.toMatch(/self-update|SelfUpdate|from "\.\/updater"/);
	});

	it("ships no self-update modules", () => {
		expect(exists("../self-update.ts")).toBe(false);
		expect(exists("../self-update-watch.ts")).toBe(false);
		expect(exists("../../shared/self-update.ts")).toBe(false);
	});

	it("has no `dev3 update` command", () => {
		expect(exists("../../cli/commands/update.ts")).toBe(false);
		expect(cliMainSource).not.toMatch(/command === "update"/);
	});
});
