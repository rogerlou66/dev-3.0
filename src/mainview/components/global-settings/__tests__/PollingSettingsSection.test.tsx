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

	it("offers the board PR lookup in minutes and the task branch status in seconds", () => {
		renderSection();
		expect(field("settings.pollingProjectPrList", "settings.pollingEvery").placeholder).toBe("1");
		const branchStatus = field("settings.pollingBranchStatus", "settings.pollingEvery");
		expect(branchStatus.placeholder).toBe("15");
		expect(branchStatus.min).toBe("5");
		expect(branchStatus.max).toBe("3600");
		expect(screen.getAllByText("settings.pollingSecondsUnit")).toHaveLength(1);
	});

	it("stores a seconds interval in `seconds`, clamped, next to existing minute overrides", () => {
		const { onChange } = renderSection({ minutes: { projectPrList: 3 } });

		fireEvent.change(field("settings.pollingBranchStatus", "settings.pollingEvery"), { target: { value: "2" } });
		expect(onChange).toHaveBeenLastCalledWith({ minutes: { projectPrList: 3 }, seconds: { branchStatusPoll: 5 } });

		fireEvent.change(field("settings.pollingProjectPrList", "settings.pollingEvery"), { target: { value: "" } });
		expect(onChange).toHaveBeenLastCalledWith(undefined);
	});

	it("switches the two renderer pollers off independently", async () => {
		const user = userEvent.setup();
		const { onChange } = renderSection();

		await user.click(screen.getByRole("switch", { name: "settings.pollingBranchStatus" }));
		expect(onChange).toHaveBeenLastCalledWith({ off: { branchStatusPoll: true } });

		await user.click(screen.getByRole("switch", { name: "settings.pollingProjectPrList" }));
		expect(onChange).toHaveBeenLastCalledWith({ off: { projectPrList: true } });
	});

	it("disables the seconds field while the task branch status is off", () => {
		renderSection({ off: { branchStatusPoll: true } });
		expect(field("settings.pollingBranchStatus", "settings.pollingEvery").disabled).toBe(true);
		expect(field("settings.pollingProjectPrList", "settings.pollingEvery").disabled).toBe(false);
	});

	it("resets every override at once", async () => {
		const user = userEvent.setup();
		const { onChange } = renderSection({ minutes: { mergeActive: 5 } });

		await user.click(screen.getByText("settings.pollingResetDefaults"));
		expect(onChange).toHaveBeenLastCalledWith(undefined);
	});
});
