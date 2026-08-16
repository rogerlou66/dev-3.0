import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
const updaterSource = readFileSync(fileURLToPath(new URL("../updater.ts", import.meta.url)), "utf8");

describe("manual updates only", () => {
	it("does not schedule update checks from the main process", () => {
		expect(mainSource).not.toMatch(/startAutoCheck|Auto-Update Check/);
	});

	it("does not expose an automatic update scheduler", () => {
		expect(updaterSource).not.toMatch(/export function startAutoCheck|CHECK_INTERVAL_MS/);
	});
});
