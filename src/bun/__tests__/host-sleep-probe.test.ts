import { describe, expect, it } from "vitest";
import { classifyGap, describeLateTick, parseSysctlTimeval } from "../host-sleep-probe";

/** Stamps shaped like the real `sysctl kern.sleeptime kern.waketime` output on macOS. */
const SLEPT_AT = 1_792_694_081_825;
const WOKE_AT = 1_792_694_207_184;

describe("parseSysctlTimeval", () => {
	it("reads the timeval sysctl prints, to the millisecond", () => {
		expect(parseSysctlTimeval("kern.waketime: { sec = 1792694207, usec = 184004 } Thu Oct 22 21:36:47 2026")).toBe(WOKE_AT);
	});

	it("gives up on anything else rather than guessing", () => {
		expect(parseSysctlTimeval("")).toBeNull();
		expect(parseSysctlTimeval("sysctl: unknown oid 'kern.waketime'")).toBeNull();
	});
});

describe("classifyGap", () => {
	it("calls it a sleep when the machine woke inside the gap", () => {
		expect(classifyGap(WOKE_AT - 30_000, { sleptAtMs: SLEPT_AT, wokeAtMs: WOKE_AT })).toBe("slept");
	});

	it("calls it a sleep when the machine went to sleep inside the gap and has not woken since", () => {
		expect(classifyGap(SLEPT_AT - 2_000, { sleptAtMs: SLEPT_AT, wokeAtMs: SLEPT_AT - 600_000 })).toBe("slept");
	});

	it("absorbs the OS stamping its sleep a moment after the last tick", () => {
		expect(classifyGap(SLEPT_AT + 500, { sleptAtMs: SLEPT_AT, wokeAtMs: null })).toBe("slept");
	});

	it("calls it a starved host when the last sleep and wake both predate the gap", () => {
		// The field case: woke at 10:22:09, late ticks from 10:22:32 on.
		expect(classifyGap(WOKE_AT + 23_000, { sleptAtMs: SLEPT_AT, wokeAtMs: WOKE_AT })).toBe("starved");
	});

	it("admits it does not know when the OS gave no stamps", () => {
		expect(classifyGap(WOKE_AT, { sleptAtMs: null, wokeAtMs: null })).toBe("unknown");
	});
});

describe("describeLateTick", () => {
	it("words each cause differently, so the log never calls a starved host a suspend", () => {
		const words = (["slept", "starved", "unknown"] as const).map(describeLateTick);
		expect(new Set(words).size).toBe(3);
		expect(describeLateTick("starved")).not.toMatch(/slept|suspend/);
	});
});
