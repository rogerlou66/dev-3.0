import { describe, expect, it } from "vitest";
import {
	POLLING_DEFAULT_MINUTES,
	POLLING_MAX_MINUTES,
	POLLING_MIN_MINUTES,
	clampPollingMinutes,
	resolvePolling,
	sanitizePollingSettings,
} from "../../shared/polling-settings";

describe("resolvePolling", () => {
	it("falls back to every default when nothing is stored", () => {
		const resolved = resolvePolling({});
		expect(resolved.enabled).toEqual({ mergeDetection: true, prStatus: true, branchStatusFetch: true, pullButtonFetch: true });
		expect(resolved.intervalMs.mergeBackground).toBe(POLLING_DEFAULT_MINUTES.mergeBackground * 60_000);
		expect(resolved.intervalMs.pullButtonFetch).toBe(3 * 60_000);
	});

	it("applies stored minutes and off flags, keeping defaults for the rest", () => {
		const resolved = resolvePolling({ polling: { off: { prStatus: true }, minutes: { prActive: 2 } } });
		expect(resolved.enabled.prStatus).toBe(false);
		expect(resolved.enabled.mergeDetection).toBe(true);
		expect(resolved.intervalMs.prActive).toBe(2 * 60_000);
		expect(resolved.intervalMs.prBackground).toBe(POLLING_DEFAULT_MINUTES.prBackground * 60_000);
	});

	it("clamps hand-edited values instead of trusting them", () => {
		const resolved = resolvePolling({ polling: { minutes: { mergeActive: 0, mergeBackground: 10_000 } } });
		expect(resolved.intervalMs.mergeActive).toBe(POLLING_MIN_MINUTES * 60_000);
		expect(resolved.intervalMs.mergeBackground).toBe(POLLING_MAX_MINUTES * 60_000);
	});
});

describe("sanitizePollingSettings", () => {
	it("rounds to whole minutes within the limits", () => {
		expect(clampPollingMinutes(2.6)).toBe(3);
		expect(clampPollingMinutes(-5)).toBe(POLLING_MIN_MINUTES);
	});

	it("returns undefined for anything that carries no valid override", () => {
		expect(sanitizePollingSettings(undefined)).toBeUndefined();
		expect(sanitizePollingSettings([])).toBeUndefined();
		expect(sanitizePollingSettings({ off: { prStatus: false }, minutes: { prActive: "5" } })).toBeUndefined();
	});
});
