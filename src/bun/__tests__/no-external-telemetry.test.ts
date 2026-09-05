import { existsSync, readFileSync, readdirSync } from "node:fs";
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

	it("has no runtime telemetry imports or tracking endpoints anywhere in app source", () => {
		const violations: string[] = [];
		for (const area of ["bun", "mainview", "shared", "cli"]) {
			const directory = join(ROOT, "src", area);
			for (const path of readdirSync(directory, { recursive: true, encoding: "utf8", withFileTypes: false })) {
				if (!/\.[cm]?[jt]sx?$/.test(path) || /(?:__tests__|test-setup|\.test\.|\.generated\.|changelog-bundled|agent-skills)/.test(path)) continue;
				const source = readFileSync(join(directory, path), "utf8");
				if (/(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*(?:analytics|posthog|telemetry-profile|telemetry-consent)[^"']*["']/.test(source)
					|| /https?:\/\/[^\s"'`]*(?:google-analytics\.com|googletagmanager\.com|posthog\.com|posthog\.cloud)/.test(source)) {
					violations.push(`src/${area}/${path}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("does not load Google tracking tags on the website", () => {
		const website = read("docs/index.html");
		expect(website).not.toMatch(/googletagmanager|google-analytics|\bgtag\s*\(/i);
	});
});
