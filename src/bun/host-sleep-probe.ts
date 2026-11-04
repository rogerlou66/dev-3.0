/**
 * Why did a host timer tick arrive late? A late tick has two causes that look the
 * same from inside the process: the machine slept, or the process was starved
 * while awake (memory pressure, a busy machine). Electrobun has no sleep/wake
 * event, so the answer is read from the OS — on demand, because late ticks are rare.
 *
 *  - **macOS:** `kern.sleeptime` / `kern.waketime` are wall-clock stamps of the last
 *    sleep entry and wake, dark wakes included. Either one inside the gap means the
 *    machine slept in it; both before it means it was awake the whole time.
 *  - **Elsewhere:** no signal is read, and the answer is honestly "unknown".
 */

import { spawn } from "./spawn";

export type LateTickCause = "slept" | "starved" | "unknown";

/** Did the machine sleep between these two wall-clock instants (ms since epoch)? */
export type SleepProbe = (gapStartMs: number, gapEndMs: number) => Promise<LateTickCause>;

/** The OS stamps the sleep a moment after the last tick it lets through; absorb that skew. */
const STAMP_SLACK_MS = 1_000;
const SYSCTL_TIMEOUT_MS = 3_000;

/** `{ sec = 1792694207, usec = 184004 } Thu Oct 22 21:36:47 2026` → epoch ms. */
export function parseSysctlTimeval(text: string): number | null {
	const match = /sec\s*=\s*(\d+)\s*,\s*usec\s*=\s*(\d+)/.exec(text);
	if (!match) return null;
	return Number(match[1]) * 1000 + Math.floor(Number(match[2]) / 1000);
}

export function classifyGap(
	gapStartMs: number,
	stamps: { sleptAtMs: number | null; wokeAtMs: number | null },
): LateTickCause {
	const { sleptAtMs, wokeAtMs } = stamps;
	if (sleptAtMs == null && wokeAtMs == null) return "unknown";
	const latest = Math.max(sleptAtMs ?? 0, wokeAtMs ?? 0);
	return latest >= gapStartMs - STAMP_SLACK_MS ? "slept" : "starved";
}

async function readSysctl(): Promise<{ sleptAtMs: number | null; wokeAtMs: number | null }> {
	const proc = spawn(["/usr/sbin/sysctl", "kern.sleeptime", "kern.waketime"], { stdout: "pipe", stderr: "ignore" });
	const timer = setTimeout(() => proc.kill(), SYSCTL_TIMEOUT_MS);
	try {
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		const line = (name: string) => out.split("\n").find((l) => l.startsWith(`${name}:`)) ?? "";
		return { sleptAtMs: parseSysctlTimeval(line("kern.sleeptime")), wokeAtMs: parseSysctlTimeval(line("kern.waketime")) };
	} finally {
		clearTimeout(timer);
	}
}

export const probeHostSleep: SleepProbe = async (gapStartMs) => {
	if (process.platform !== "darwin") return "unknown";
	try {
		return classifyGap(gapStartMs, await readSysctl());
	} catch {
		return "unknown";
	}
};

/** One wording for every log line that reports a late host tick. */
export function describeLateTick(cause: LateTickCause): string {
	switch (cause) {
		case "slept":
			return "the machine slept through it";
		case "starved":
			return "the machine was awake — the host process was starved";
		case "unknown":
			return "cause unknown (sleep or a starved host)";
	}
}
