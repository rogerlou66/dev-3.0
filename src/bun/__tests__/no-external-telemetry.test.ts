import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(path: string): string {
	return readFileSync(join(ROOT, path), "utf8");
}

describe("external telemetry removal", () => {
	it("does not ship GA4 or PostHog runtime clients", () => {
		expect(existsSync(join(ROOT, "src/mainview/analytics.ts"))).toBe(false);
		expect(existsSync(join(ROOT, "src/mainview/posthog.ts"))).toBe(false);
		expect(existsSync(join(ROOT, "src/mainview/telemetry.ts"))).toBe(false);
		expect(read("package.json")).not.toContain("posthog-js");
		expect(read("src/mainview/main.tsx")).not.toMatch(/initAnalytics|posthog|feature-flags/i);
	});

	it("does not inject telemetry credentials into release builds", () => {
		for (const platform of ["macos", "linux", "windows"]) {
			expect(read(`.github/workflows/release-build-${platform}.yml`)).not.toMatch(
				/VITE_(?:POSTHOG_(?:KEY|HOST)|TELEMETRY)/,
			);
		}
	});

	it("does not load Google tracking tags on the website", () => {
		const website = read("docs/index.html");
		expect(website).not.toMatch(/googletagmanager|google-analytics|\bgtag\s*\(/i);
	});
});
