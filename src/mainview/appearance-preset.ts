import { parseAppearancePreset, presetForcesDark, type AppearancePreset } from "../shared/appearance-preset";
import { useSyncExternalStore } from "react";
import { api } from "./rpc";
import { APPEARANCE_PRESET_CHANGE_EVENT } from "./appearance-preset-store";
import type { GlobalSettings } from "../shared/types";
import { getInitialThemeState, type ThemePreference } from "./theme-bootstrap";
import { setTerminalFontOverride } from "./terminal-font";

export type { AppearancePreset };
export { parseAppearancePreset };
const STORAGE_KEY = "dev3-appearance-preset";
const CHANGE_EVENT = APPEARANCE_PRESET_CHANGE_EVENT;
let current: AppearancePreset = "default";

export function getAppearancePreset(): AppearancePreset { return current; }

function subscribe(callback: () => void) {
	window.addEventListener(CHANGE_EVENT, callback);
	return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function useAppearancePreset(): AppearancePreset {
	return useSyncExternalStore(subscribe, getAppearancePreset, () => "default");
}

export function resolveAppearanceTheme(preference: ThemePreference, prefersDark: boolean, preset = current) {
	return presetForcesDark(preset) ? "dark" : preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

function savedTheme(): ThemePreference {
	return getInitialThemeState({ localStorageTheme: localStorage.getItem("dev3-theme"), prefersDark: false }).preference;
}

function applyPreset(preset: AppearancePreset) {
	current = preset;
	localStorage.setItem(STORAGE_KEY, preset);
	document.documentElement.dataset.appearancePreset = preset;
	document.documentElement.dataset.theme = resolveAppearanceTheme(savedTheme(), window.matchMedia("(prefers-color-scheme: dark)").matches);
	setTerminalFontOverride(preset === "cmux" ? { family: "SF Mono", size: 14 } : null);
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function setAppearancePreset(preset: AppearancePreset): Promise<void> {
	const preference = savedTheme();
	await api.request.setTmuxTheme({
		theme: resolveAppearanceTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches, preset),
		preference,
		appearancePreset: preset,
	});
	applyPreset(preset);
}

export async function applyThemePreference(preference: ThemePreference): Promise<void> {
	if (presetForcesDark(current)) return;
	const theme = resolveAppearanceTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
	await api.request.setTmuxTheme({ theme, preference, appearancePreset: current });
	localStorage.setItem("dev3-theme", preference);
	document.documentElement.dataset.theme = theme;
}

export function bootstrapAppearancePreset() {
	const injected = (window as Window & { __DEV3_INITIAL_APPEARANCE_PRESET__?: string }).__DEV3_INITIAL_APPEARANCE_PRESET__;
	applyPreset(parseAppearancePreset(injected ?? localStorage.getItem(STORAGE_KEY)));
	window.addEventListener("rpc:globalSettingsUpdated", (event) => {
		syncAppearanceSettings((event as CustomEvent<GlobalSettings>).detail);
	});
}

export function syncAppearanceSettings(settings: GlobalSettings) {
	if (settings.theme) localStorage.setItem("dev3-theme", settings.theme);
	applyPreset(parseAppearancePreset(settings.appearancePreset));
}
