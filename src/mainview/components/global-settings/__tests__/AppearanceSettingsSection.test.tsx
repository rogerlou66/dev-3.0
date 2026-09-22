import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "../../../i18n";
import AppearanceSettingsSection from "../AppearanceSettingsSection";

const state = vi.hoisted(() => ({
	preset: "default" as "default" | "cmux",
	save: vi.fn(),
	error: vi.fn(),
}));
vi.mock("../../../appearance-preset", () => ({
	useAppearancePreset: () => state.preset,
	setAppearancePreset: state.save,
}));
vi.mock("../../../toast", () => ({ toast: { error: state.error } }));
vi.mock("../../HelpSpot", () => ({ default: () => null }));
vi.mock("../SettingsSection", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../SettingsEntry", () => ({ default: ({ children }: { children: ReactNode }) => children }));

const t = ((key: string) => key) as TFunction;
function section(onThemeChange = vi.fn()) {
	return <AppearanceSettingsSection t={t} locale="en" theme="light" zoomLevel={1}
		onThemeChange={onThemeChange} onLocaleChange={vi.fn()} onSimplifyModeToggle={vi.fn()} />;
}

beforeEach(() => {
	state.preset = "default";
	state.save.mockReset().mockResolvedValue(undefined);
	state.error.mockReset();
});

describe("appearance preset controls", () => {
	it("uses the preset setter and reports persistence failures", async () => {
		state.save.mockRejectedValueOnce(new Error("offline"));
		render(section());
		fireEvent.click(screen.getByRole("button", { name: /cmux/ }));
		await waitFor(() => expect(state.error).toHaveBeenCalledWith("settings.appearancePresetSaveError"));
		expect(state.save).toHaveBeenCalledWith("cmux");
		expect((screen.getByRole("button", { name: /cmux/ }) as HTMLButtonElement).disabled).toBe(false);
	});

	it("locks dark while managed and restores the saved light selection", () => {
		state.preset = "cmux";
		const onThemeChange = vi.fn();
		const view = render(section(onThemeChange));
		const dark = screen.getByRole("button", { name: /settings.themeDark / });
		const light = screen.getByRole("button", { name: /settings.themeLight / });
		expect((dark as HTMLButtonElement).disabled).toBe(true);
		expect(dark.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(light);
		expect(onThemeChange).not.toHaveBeenCalled();
		state.preset = "default";
		view.rerender(section(onThemeChange));
		expect((light as HTMLButtonElement).disabled).toBe(false);
		expect(light.getAttribute("aria-pressed")).toBe("true");
	});
});
