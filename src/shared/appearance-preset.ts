export type AppearancePreset = "default" | "cmux" | "clarity";

export function parseAppearancePreset(value: unknown): AppearancePreset {
	return value === "cmux" || value === "clarity" ? value : "default";
}

/** Presets that pin the UI (and tmux) to the dark theme. */
export function presetForcesDark(preset: AppearancePreset | undefined): boolean {
	return preset === "cmux" || preset === "clarity";
}
