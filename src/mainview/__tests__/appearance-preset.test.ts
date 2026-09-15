import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../state";
import type { GlobalSettings } from "../../shared/types";

const { setTmuxTheme } = vi.hoisted(() => ({ setTmuxTheme: vi.fn() }));
vi.mock("../rpc", () => ({ api: { request: { setTmuxTheme } } }));

let appearance: typeof import("../appearance-preset");
let fonts: typeof import("../terminal-font");
let prefersDark: boolean;
let eventSpy: ReturnType<typeof vi.spyOn>;
const injectedWindow = window as Window & { __DEV3_INITIAL_APPEARANCE_PRESET__?: string };

beforeEach(async () => {
	vi.resetModules();
	setTmuxTheme.mockReset().mockResolvedValue(undefined);
	localStorage.clear();
	delete injectedWindow.__DEV3_INITIAL_APPEARANCE_PRESET__;
	delete document.documentElement.dataset.appearancePreset;
	delete document.documentElement.dataset.theme;
	prefersDark = false;
	vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: prefersDark }) as MediaQueryList);
	eventSpy = vi.spyOn(window, "addEventListener");
	appearance = await import("../appearance-preset");
	fonts = await import("../terminal-font");
	fonts.bootstrapTerminalFont();
});

afterEach(() => {
	for (const [name, listener, options] of eventSpy.mock.calls) {
		window.removeEventListener(name, listener, options);
	}
	delete injectedWindow.__DEV3_INITIAL_APPEARANCE_PRESET__;
	vi.restoreAllMocks();
});

describe("appearance preset lifecycle", () => {
	it.each(["light", "system"] as const)("restores saved %s theme and custom font after Default → cmux → Default", async (theme) => {
		localStorage.setItem("dev3-theme", theme);
		fonts.applyTerminalFontFamily("FiraCode Nerd Font Mono");
		fonts.applyTerminalFontSize(20);
		appearance.bootstrapAppearancePreset();
		expect(document.documentElement.dataset.theme).toBe("light");

		const fontChange = vi.fn();
		window.addEventListener(fonts.TERMINAL_FONT_CHANGED_EVENT, fontChange);
		await appearance.setAppearancePreset("cmux");
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(document.documentElement.dataset.appearancePreset).toBe("cmux");
		expect(fonts.effectiveTerminalFontSize()).toBe(14);
		expect(fonts.terminalFontStack()).toMatch(/^'SF Mono', 'JetBrainsMono Nerd Font Mono'/);
		expect(fonts.getTerminalFontFamily()).toBe("FiraCode Nerd Font Mono");
		expect(fonts.getTerminalFontSize()).toBe(20);
		expect(localStorage.getItem("dev3-terminal-font-family")).toBe("FiraCode Nerd Font Mono");
		expect(localStorage.getItem("dev3-terminal-font-size")).toBe("20");
		expect(localStorage.getItem("dev3-theme")).toBe(theme);
		expect(fontChange).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ family: "SF Mono", size: 14 }) }));

		await appearance.setAppearancePreset("default");
		expect(document.documentElement.dataset.theme).toBe("light");
		expect(fonts.effectiveTerminalFontSize()).toBe(19.5);
		expect(fonts.terminalFontStack()).toMatch(/^'FiraCode Nerd Font Mono'/);
		expect(setTmuxTheme).toHaveBeenLastCalledWith({ theme: "light", preference: theme, appearancePreset: "default" });
	});

	it("uses the persisted preset at reload before terminals are created", () => {
		localStorage.setItem("dev3-appearance-preset", "cmux");
		localStorage.setItem("dev3-theme", "light");
		localStorage.setItem("dev3-terminal-font-size", "22");
		fonts.bootstrapTerminalFont();
		appearance.bootstrapAppearancePreset();
		expect(appearance.getAppearancePreset()).toBe("cmux");
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(fonts.effectiveTerminalFontSize()).toBe(14);
		expect(fonts.getTerminalFontSize()).toBe(22);
		expect(setTmuxTheme).not.toHaveBeenCalled();
	});

	it.each(["default", "cmux"] as const)("prefers the server-injected %s preset over local storage", (preset) => {
		localStorage.setItem("dev3-appearance-preset", preset === "cmux" ? "default" : "cmux");
		injectedWindow.__DEV3_INITIAL_APPEARANCE_PRESET__ = preset;
		appearance.bootstrapAppearancePreset();
		expect(appearance.getAppearancePreset()).toBe(preset);
		expect(localStorage.getItem("dev3-appearance-preset")).toBe(preset);
	});

	it("keeps cmux dark across OS theme changes and all theme menu commands", async () => {
		localStorage.setItem("dev3-theme", "system");
		appearance.bootstrapAppearancePreset();
		await appearance.setAppearancePreset("cmux");
		setTmuxTheme.mockClear();
		for (const dark of [true, false]) {
			prefersDark = dark;
			expect(appearance.resolveAppearanceTheme("system", dark)).toBe("dark");
		}
		const { handleMenuAction } = await import("../menuRouter");
		const ctx = { state: {} as AppState, dispatch: vi.fn(), setLocale: vi.fn(), t: vi.fn() as never };
		for (const command of ["set-theme-light", "set-theme-dark", "set-theme-auto"]) {
			await handleMenuAction(command, ctx);
		}
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(localStorage.getItem("dev3-theme")).toBe("system");
		expect(setTmuxTheme).not.toHaveBeenCalled();
	});

	it("does not apply or persist a preset until its save succeeds", async () => {
		localStorage.setItem("dev3-theme", "light");
		appearance.bootstrapAppearancePreset();
		setTmuxTheme.mockRejectedValueOnce(new Error("offline"));
		await expect(appearance.setAppearancePreset("cmux")).rejects.toThrow("offline");
		expect(appearance.getAppearancePreset()).toBe("default");
		expect(document.documentElement.dataset.theme).toBe("light");
		expect(localStorage.getItem("dev3-appearance-preset")).toBe("default");
		expect(fonts.terminalFontStack()).toBe(fonts.DEFAULT_TERMINAL_FONT_STACK);
	});

	it("retains active cmux if switching back fails", async () => {
		appearance.bootstrapAppearancePreset();
		await appearance.setAppearancePreset("cmux");
		setTmuxTheme.mockRejectedValueOnce(new Error("offline"));
		await expect(appearance.setAppearancePreset("default")).rejects.toThrow("offline");
		expect(appearance.getAppearancePreset()).toBe("cmux");
		expect(fonts.effectiveTerminalFontSize()).toBe(14);
	});

	it("hydrates a desktop with no local preset from authoritative saved settings", async () => {
		appearance.bootstrapAppearancePreset();
		expect(appearance.getAppearancePreset()).toBe("default");
		appearance.syncAppearanceSettings({ appearancePreset: "cmux", theme: "light" } as GlobalSettings);
		expect(appearance.getAppearancePreset()).toBe("cmux");
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(localStorage.getItem("dev3-theme")).toBe("light");
		expect(setTmuxTheme).not.toHaveBeenCalled();
		await appearance.setAppearancePreset("default");
		expect(document.documentElement.dataset.theme).toBe("light");
	});

	it("applies server settings broadcasts without sending an echo RPC", () => {
		appearance.bootstrapAppearancePreset();
		window.dispatchEvent(new CustomEvent("rpc:globalSettingsUpdated", { detail: { appearancePreset: "cmux", theme: "light" } }));
		expect(appearance.getAppearancePreset()).toBe("cmux");
		expect(document.documentElement.dataset.theme).toBe("dark");
		window.dispatchEvent(new CustomEvent("rpc:globalSettingsUpdated", { detail: { appearancePreset: "default", theme: "system" } }));
		expect(appearance.getAppearancePreset()).toBe("default");
		expect(document.documentElement.dataset.theme).toBe("light");
		expect(localStorage.getItem("dev3-theme")).toBe("system");
		expect(setTmuxTheme).not.toHaveBeenCalled();
	});
});
