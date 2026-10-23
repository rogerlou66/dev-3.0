import type { GlobalSettings, PollingGroup, PollingIntervalKey, PollingSettings } from "./types";

/**
 * Defaults and resolution for Settings → Polling. Shared by the bun pollers and
 * the renderer so the placeholders the user sees are the values actually used.
 * Only automatic polling reads this; an explicit refresh or git action always runs.
 */

const MINUTE_MS = 60_000;

export const POLLING_GROUPS: readonly PollingGroup[] = ["mergeDetection", "prStatus", "branchStatusFetch", "pullButtonFetch"];

export const POLLING_DEFAULT_MINUTES: Readonly<Record<PollingIntervalKey, number>> = {
	mergeActive: 1,
	mergeBackground: 10,
	prActive: 5,
	prBackground: 15,
	prPendingActive: 1,
	prPendingBackground: 5,
	branchStatusFetch: 1,
	pullButtonFetch: 3,
};

export const POLLING_INTERVAL_KEYS = Object.keys(POLLING_DEFAULT_MINUTES) as PollingIntervalKey[];

// The background pollers tick once a minute, so a shorter interval could never be honored.
export const POLLING_MIN_MINUTES = 1;
export const POLLING_MAX_MINUTES = 120;

export interface ResolvedPolling {
	enabled: Record<PollingGroup, boolean>;
	intervalMs: Record<PollingIntervalKey, number>;
}

export function clampPollingMinutes(value: number): number {
	return Math.min(POLLING_MAX_MINUTES, Math.max(POLLING_MIN_MINUTES, Math.round(value)));
}

/** Untrusted `settings.json` shape in, sparse valid shape out; nothing set ⇒ undefined. */
export function sanitizePollingSettings(raw: unknown): PollingSettings | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const source = raw as { off?: unknown; minutes?: unknown };

	const off: Partial<Record<PollingGroup, true>> = {};
	if (source.off && typeof source.off === "object") {
		for (const group of POLLING_GROUPS) {
			if ((source.off as Record<string, unknown>)[group] === true) off[group] = true;
		}
	}

	const minutes: Partial<Record<PollingIntervalKey, number>> = {};
	if (source.minutes && typeof source.minutes === "object") {
		for (const key of POLLING_INTERVAL_KEYS) {
			const value = (source.minutes as Record<string, unknown>)[key];
			if (typeof value === "number" && Number.isFinite(value)) minutes[key] = clampPollingMinutes(value);
		}
	}

	const result: PollingSettings = {};
	if (Object.keys(off).length > 0) result.off = off;
	if (Object.keys(minutes).length > 0) result.minutes = minutes;
	return Object.keys(result).length > 0 ? result : undefined;
}

export function resolvePolling(settings: Pick<GlobalSettings, "polling"> | null | undefined): ResolvedPolling {
	const polling = sanitizePollingSettings(settings?.polling);
	const enabled = Object.fromEntries(
		POLLING_GROUPS.map((group) => [group, polling?.off?.[group] !== true]),
	) as Record<PollingGroup, boolean>;
	const intervalMs = Object.fromEntries(
		POLLING_INTERVAL_KEYS.map((key) => [key, (polling?.minutes?.[key] ?? POLLING_DEFAULT_MINUTES[key]) * MINUTE_MS]),
	) as Record<PollingIntervalKey, number>;
	return { enabled, intervalMs };
}
