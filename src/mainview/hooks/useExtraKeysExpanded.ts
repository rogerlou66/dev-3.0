import { useSyncExternalStore } from "react";

export const EXTRA_KEYS_STORAGE_KEY = "dev3-extra-keys-expanded";
const CHANGED = "dev3:extra-keys-expanded";
let memoryOverride: boolean | null = null;

function snapshot(): boolean {
	if (memoryOverride !== null) return memoryOverride;
	try { return localStorage.getItem(EXTRA_KEYS_STORAGE_KEY) === "true"; }
	catch { return false; }
}

function subscribe(notify: () => void) {
	const storage = (event: StorageEvent) => {
		if (event.key === EXTRA_KEYS_STORAGE_KEY || event.key === null) {
			memoryOverride = null;
			notify();
		}
	};
	window.addEventListener(CHANGED, notify);
	window.addEventListener("storage", storage);
	return () => {
		window.removeEventListener(CHANGED, notify);
		window.removeEventListener("storage", storage);
	};
}

export function setExtraKeysExpanded(expanded: boolean): void {
	try {
		localStorage.setItem(EXTRA_KEYS_STORAGE_KEY, String(expanded));
		memoryOverride = null;
	} catch {
		memoryOverride = expanded;
	}
	window.dispatchEvent(new Event(CHANGED));
}

export function useExtraKeysExpanded(): [boolean, (expanded: boolean) => void] {
	return [useSyncExternalStore(subscribe, snapshot, () => false), setExtraKeysExpanded];
}
