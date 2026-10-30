import { useEffect, useState } from "react";
import { api } from "../rpc";
import type { GlobalSettings } from "../../shared/types";
import { resolvePolling, type ResolvedPolling } from "../../shared/polling-settings";
import { getCachedGlobalSettings } from "../global-settings-cache";

/**
 * Settings → Polling for renderer-side pollers. Seeds from the settings cache
 * App.tsx keeps, so the first tick already uses the user's cadence, and follows
 * the `globalSettingsUpdated` push so a change applies without a remount.
 * Callers should depend on the primitive `enabled.X` / `intervalMs.X` values:
 * the object itself is new on every settings write.
 */
export function usePollingSettings(): ResolvedPolling {
	const [polling, setPolling] = useState<ResolvedPolling>(() => resolvePolling(getCachedGlobalSettings()));

	useEffect(() => {
		let alive = true;
		if (!getCachedGlobalSettings()) {
			// Wrapped so a missing RPC method rejects instead of throwing out of the effect.
			Promise.resolve()
				.then(() => api.request.getGlobalSettings())
				.then((settings) => { if (alive) setPolling(resolvePolling(settings)); })
				.catch(() => {});
		}
		function onUpdated(e: Event) {
			setPolling(resolvePolling((e as CustomEvent<GlobalSettings>).detail));
		}
		window.addEventListener("rpc:globalSettingsUpdated", onUpdated);
		return () => {
			alive = false;
			window.removeEventListener("rpc:globalSettingsUpdated", onUpdated);
		};
	}, []);

	return polling;
}
