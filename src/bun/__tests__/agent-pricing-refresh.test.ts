import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeTokenCostUsd } from "../../shared/agent-pricing";

let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;
const NOW = Date.parse("2026-11-03T12:00:00Z");
const rate = (input: number, output = 12) => ({ input, output, cacheRead: 0.15, cacheWrite5m: 4, cacheWrite1h: 6 });

function save(rates: Record<string, unknown>, fetchedAt = NOW) {
	writeFileSync(join(dir, "agent-pricing-v1.json"), JSON.stringify({ version: 1, fetchedAt, rates }));
}

beforeEach(() => {
	vi.resetModules();
	dir = mkdtempSync(join(tmpdir(), "dev3-pricing-"));
	vi.stubEnv("DEV3_HOME", dir);
	vi.spyOn(Date, "now").mockReturnValue(NOW);
	fetchMock = vi.fn().mockRejectedValue(new Error("External pricing requests are forbidden"));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

describe("local agent pricing", () => {
	it("uses bundled prices for repeated usage reports and price descriptions without fetching", async () => {
		const { getPricingResolver, describePricing } = await import("../agent-pricing-refresh");
		for (let i = 0; i < 3; i++) {
			expect((await getPricingResolver())("gpt-6.1-sol")?.input).toBe(2);
			expect((await describePricing()).fetchedAt).toBeNull();
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("retains saved prices across restarts without refreshing an old cache", async () => {
		save({ "openai:gpt-6.1-sol": rate(3) }, NOW - 30 * 24 * 60 * 60_000);
		const first = await import("../agent-pricing-refresh");
		expect((await first.getPricingResolver())("gpt-6.1-sol")).toEqual(rate(3));
		vi.resetModules();
		const { getPricingResolver, describePricing } = await import("../agent-pricing-refresh");
		expect((await getPricingResolver())("gpt-6.1-sol")).toEqual(rate(3));
		expect((await describePricing()).fetchedAt).toBe(NOW - 30 * 24 * 60 * 60_000);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps direct and OpenRouter prices distinct and normalizes known Claude aliases", async () => {
		save({
			"openai:gpt-6.1-sol": rate(3),
			"openrouter:openai/gpt-6.1-sol": rate(7),
			"google:gemini-test": rate(1.5),
			"openrouter:google/gemini-test": rate(9),
			"anthropic:claude-sonnet-4-6": rate(8),
			"anthropic:claude-opus-4-5": rate(12),
		});
		const { getPricingResolver, describePricing } = await import("../agent-pricing-refresh");
		const resolve = await getPricingResolver();
		expect(resolve("gpt-6.1-sol")?.input).toBe(3);
		expect(resolve("openrouter/openai/gpt-6.1-sol")?.input).toBe(7);
		expect(resolve("gemini-test")?.input).toBe(1.5);
		expect(resolve("openrouter/google/gemini-test")?.input).toBe(9);
		for (const id of ["sonnet-4.6", "claude-sonnet-4.6", "anthropic/claude-sonnet-4.6"]) expect(resolve(id)?.input).toBe(8);
		expect(resolve("claude-4.5-opus-high-thinking")?.input).toBe(12);
		for (const id of ["unrelated-vendor/gemini-test", "composer-1", "private-model"]) expect(resolve(id)).toBeNull();
		const described = await describePricing();
		for (const id of ["gpt-6.1-sol", "google/gemini-test", "claude-sonnet-4.6", "unknown"]) expect(described.resolve(id)).toEqual(resolve(id));
	});

	it("uses cached prices to calculate token costs", async () => {
		save({ "openai:gpt-6.1-sol": rate(3) });
		const resolve = await (await import("../agent-pricing-refresh")).getPricingResolver();
		expect(computeTokenCostUsd("gpt-6.1-sol", {
			inputTokens: 1_000_000, outputTokens: 1_000_000,
			cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000,
		}, resolve)).toEqual({ costUsd: 19.15, priced: true });
	});

	it.each(["{bad-json", JSON.stringify({ version: 1, fetchedAt: NOW, rates: { "openai:gpt-6.1-sol": { input: -1 } } }), JSON.stringify({ version: 1, fetchedAt: NOW + 600_000, rates: { "openai:gpt-6.1-sol": rate(3) } })])(
		"falls back to bundled prices for invalid saved data: %s", async (value) => {
			writeFileSync(join(dir, "agent-pricing-v1.json"), value);
			const { getPricingResolver, describePricing } = await import("../agent-pricing-refresh");
			expect((await getPricingResolver())("gpt-6.1-sol")?.input).toBe(2);
			expect((await describePricing()).fetchedAt).toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
});
