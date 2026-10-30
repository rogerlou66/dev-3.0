import type { GlobalSettings, PollingGroup, PollingIntervalKey, PollingSecondsKey, PollingSettings } from "./types";

/**
 * Defaults and resolution for Settings → Polling. Shared by the bun pollers and
 * the renderer so the placeholders the user sees are the values actually used.
 * Only automatic polling reads this; an explicit refresh or git action always runs.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

export const POLLING_GROUPS: readonly PollingGroup[] = [
	"mergeDetection",
	"prStatus",
	"projectPrList",
	"branchStatusPoll",
	"branchStatusFetch",
	"pullButtonFetch",
];

export const POLLING_DEFAULT_MINUTES: Readonly<Record<PollingIntervalKey, number>> = {
	mergeActive: 1,
	mergeBackground: 10,
	prActive: 5,
	prBackground: 15,
	prPendingActive: 1,
	prPendingBackground: 5,
	projectPrList: 1,
	branchStatusFetch: 1,
	pullButtonFetch: 3,
};

export const POLLING_DEFAULT_SECONDS: Readonly<Record<PollingSecondsKey, number>> = {
	branchStatusPoll: 15,
};

export const POLLING_INTERVAL_KEYS = Object.keys(POLLING_DEFAULT_MINUTES) as PollingIntervalKey[];
export const POLLING_SECONDS_KEYS = Object.keys(POLLING_DEFAULT_SECONDS) as PollingSecondsKey[];

// The background pollers tick once a minute, so a shorter interval could never be honored.
export const POLLING_MIN_MINUTES = 1;
export const POLLING_MAX_MINUTES = 120;

// Every branch-status tick runs `gh`; the floor keeps a typo from spending the API quota.
export const POLLING_MIN_SECONDS = 5;
export const POLLING_MAX_SECONDS = 3600;

export interface ResolvedPolling {
	enabled: Record<PollingGroup, boolean>;
	intervalMs: Record<PollingIntervalKey | PollingSecondsKey, number>;
}

export function clampPollingMinutes(value: number): number {
	return Math.min(POLLING_MAX_MINUTES, Math.max(POLLING_MIN_MINUTES, Math.round(value)));
}

export function clampPollingSeconds(value: number): number {
	return Math.min(POLLING_MAX_SECONDS, Math.max(POLLING_MIN_SECONDS, Math.round(value)));
}

function sanitizeIntervals<K extends string>(
	raw: unknown,
	keys: readonly K[],
	clamp: (value: number) => number,
): Partial<Record<K, number>> {
	const result: Partial<Record<K, number>> = {};
	if (!raw || typeof raw !== "object") return result;
	for (const key of keys) {
		const value = (raw as Record<string, unknown>)[key];
		if (typeof value === "number" && Number.isFinite(value)) result[key] = clamp(value);
	}
	return result;
}

/** Untrusted `settings.json` shape in, sparse valid shape out; nothing set ⇒ undefined. */
export function sanitizePollingSettings(raw: unknown): PollingSettings | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const source = raw as { off?: unknown; minutes?: unknown; seconds?: unknown };

	const off: Partial<Record<PollingGroup, true>> = {};
	if (source.off && typeof source.off === "object") {
		for (const group of POLLING_GROUPS) {
			if ((source.off as Record<string, unknown>)[group] === true) off[group] = true;
		}
	}

	const minutes = sanitizeIntervals(source.minutes, POLLING_INTERVAL_KEYS, clampPollingMinutes);
	const seconds = sanitizeIntervals(source.seconds, POLLING_SECONDS_KEYS, clampPollingSeconds);

	const result: PollingSettings = {};
	if (Object.keys(off).length > 0) result.off = off;
	if (Object.keys(minutes).length > 0) result.minutes = minutes;
	if (Object.keys(seconds).length > 0) result.seconds = seconds;
	return Object.keys(result).length > 0 ? result : undefined;
}

export function resolvePolling(settings: Pick<GlobalSettings, "polling"> | null | undefined): ResolvedPolling {
	const polling = sanitizePollingSettings(settings?.polling);
	const enabled = Object.fromEntries(
		POLLING_GROUPS.map((group) => [group, polling?.off?.[group] !== true]),
	) as Record<PollingGroup, boolean>;
	const intervalMs = Object.fromEntries([
		...POLLING_INTERVAL_KEYS.map((key) => [key, (polling?.minutes?.[key] ?? POLLING_DEFAULT_MINUTES[key]) * MINUTE_MS]),
		...POLLING_SECONDS_KEYS.map((key) => [key, (polling?.seconds?.[key] ?? POLLING_DEFAULT_SECONDS[key]) * SECOND_MS]),
	]) as Record<PollingIntervalKey | PollingSecondsKey, number>;
	return { enabled, intervalMs };
}
