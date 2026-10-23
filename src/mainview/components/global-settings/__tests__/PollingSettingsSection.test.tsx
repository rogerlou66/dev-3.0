import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../../../shared/types";
import { I18nProvider, type TFunction } from "../../../i18n";
import PollingSettingsSection from "../PollingSettingsSection";

const t = ((key: string) => key) as unknown as TFunction;

function renderSection(polling?: GlobalSettings["polling"]) {
	const onChange = vi.fn();
	render(
		<I18nProvider>
			<PollingSettingsSection t={t} globalSettings={{ polling } as GlobalSettings} onChange={onChange} />
		</I18nProvider>,
	);
	return { onChange };
}

const field = (group: string, label: string) => screen.getByLabelText(`${group}: ${label}`) as HTMLInputElement;

describe("PollingSettingsSection", () => {
	it("shows each default as a placeholder and no reset link while nothing is overridden", () => {
		renderSection();
		expect(field("settings.pollingMergeDetection", "settings.pollingOtherProjects").placeholder).toBe("10");
		expect(field("settings.pollingPullButton", "settings.pollingEvery").placeholder).toBe("3");
		expect(screen.queryByText("settings.pollingResetDefaults")).toBeNull();
	});

	it("stores a typed interval, clamped, and an emptied field falls back to the default", () => {
		const { onChange } = renderSection({ minutes: { prActive: 4 } });

		fireEvent.change(field("settings.pollingPrStatus", "settings.pollingOnScreenProject"), { target: { value: "500" } });
		expect(onChange).toHaveBeenLastCalledWith({ minutes: { prActive: 120 } });

		fireEvent.change(field("settings.pollingPrStatus", "settings.pollingOnScreenProject"), { target: { value: "" } });
		expect(onChange).toHaveBeenLastCalledWith(undefined);
	});

	it("switches a group off, disabling its fields, and back on", async () => {
		const user = userEvent.setup();
		const { onChange } = renderSection({ off: { prStatus: true } });

		expect(field("settings.pollingPrStatus", "settings.pollingOnScreenProject").disabled).toBe(true);
		await user.click(screen.getByRole("switch", { name: "settings.pollingPrStatus" }));
		expect(onChange).toHaveBeenLastCalledWith(undefined);

		await user.click(screen.getByRole("switch", { name: "settings.pollingGitBar" }));
		expect(onChange).toHaveBeenLastCalledWith({ off: { prStatus: true, branchStatusFetch: true } });
	});

	it("resets every override at once", async () => {
		const user = userEvent.setup();
		const { onChange } = renderSection({ minutes: { mergeActive: 5 } });

		await user.click(screen.getByText("settings.pollingResetDefaults"));
		expect(onChange).toHaveBeenLastCalledWith(undefined);
	});
});
