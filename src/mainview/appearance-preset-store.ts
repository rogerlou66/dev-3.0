import { useSyncExternalStore } from "react";
import { parseAppearancePreset, type AppearancePreset } from "../shared/appearance-preset";

/** Must match CHANGE_EVENT in appearance-preset.ts, which dispatches it after updating the <html> dataset. */
export const APPEARANCE_PRESET_CHANGE_EVENT = "appearance-preset-changed";

function subscribe(callback: () => void) {
	window.addEventListener(APPEARANCE_PRESET_CHANGE_EVENT, callback);
	return () => window.removeEventListener(APPEARANCE_PRESET_CHANGE_EVENT, callback);
}

function readPreset(): AppearancePreset {
	return parseAppearancePreset(document.documentElement.dataset.appearancePreset);
}

/** RPC-free read of the active preset, for hooks used throughout the board. */
export function useActiveAppearancePreset(): AppearancePreset {
	return useSyncExternalStore(subscribe, readPreset, () => "default");
}
