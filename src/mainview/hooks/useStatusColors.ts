import type { TaskStatus } from "../../shared/types";
import { STATUS_COLORS, STATUS_COLORS_CLARITY, STATUS_COLORS_LIGHT, STATUS_COLORS_LIGHT_INK } from "../../shared/types";
import { useActiveAppearancePreset } from "../appearance-preset-store";
import { useResolvedTheme } from "./useResolvedTheme";
import { BLOCKED_COLORS } from "../../shared/task-blocking";

const DARK_COLORS = { ...STATUS_COLORS, blocked: BLOCKED_COLORS.dark };
const LIGHT_COLORS = { ...STATUS_COLORS_LIGHT, blocked: BLOCKED_COLORS.light };
const LIGHT_INK_COLORS = { ...STATUS_COLORS_LIGHT_INK, blocked: BLOCKED_COLORS.light };
const CLARITY_COLORS = { ...STATUS_COLORS_CLARITY, blocked: BLOCKED_COLORS.dark };

export function useStatusColors(): Record<TaskStatus | "blocked", string> {
	const theme = useResolvedTheme();
	const preset = useActiveAppearancePreset();
	if (preset === "clarity") return CLARITY_COLORS;
	return theme === "light" ? LIGHT_COLORS : DARK_COLORS;
}

/**
 * Like useStatusColors, but returns values safe to use as **text ink** in
 * light theme — STATUS_COLORS_LIGHT_INK (darker variants that clear
 * APCA |Lc| ≥ 60 on the glass column header).  In dark theme the standard
 * STATUS_COLORS are used unchanged (they already work as text).
 */
export function useStatusColorsInk(): Record<TaskStatus | "blocked", string> {
	const theme = useResolvedTheme();
	const preset = useActiveAppearancePreset();
	if (preset === "clarity") return CLARITY_COLORS;
	return theme === "light" ? LIGHT_INK_COLORS : DARK_COLORS;
}
