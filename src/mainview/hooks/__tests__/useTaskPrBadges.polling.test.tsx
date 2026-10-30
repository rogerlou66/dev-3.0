import { act, renderHook } from "@testing-library/react";
import type { GlobalSettings, Task } from "../../../shared/types";
import { useTaskPrBadges } from "../useTaskPrBadges";

const getProjectPRs = vi.fn();
let cachedSettings: Partial<GlobalSettings> | null = null;

vi.mock("../../rpc", () => ({
	api: { request: { getProjectPRs: (...args: unknown[]) => getProjectPRs(...args) } },
}));

vi.mock("../../global-settings-cache", () => ({
	getCachedGlobalSettings: () => cachedSettings,
}));

const tasks = [{ id: "t1", projectId: "p1", branchName: "feat/x" } as Task];
const discoverProjectIds = ["p1", "p2"];

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useTaskPrBadges — Settings → Polling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		cachedSettings = null;
		getProjectPRs.mockResolvedValue([{ number: 7, url: "https://example.test/pr/7", headRefName: "feat/x" }]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("looks up every project once a minute by default", async () => {
		const { result } = renderHook(() => useTaskPrBadges({ tasks, discoverProjectIds }));
		await advance(0);
		expect(getProjectPRs).toHaveBeenCalledTimes(2);
		expect(result.current.get("t1")?.number).toBe(7);

		await advance(75_000);
		expect(getProjectPRs).toHaveBeenCalledTimes(4);
	});

	it("honors the configured interval", async () => {
		cachedSettings = { polling: { minutes: { projectPrList: 5 } } };
		renderHook(() => useTaskPrBadges({ tasks, discoverProjectIds }));
		await advance(0);
		expect(getProjectPRs).toHaveBeenCalledTimes(2);

		await advance(3 * 60_000);
		expect(getProjectPRs).toHaveBeenCalledTimes(2);

		await advance(4 * 60_000);
		expect(getProjectPRs).toHaveBeenCalledTimes(4);
	});

	it("never calls gh while switched off, and resumes on a settings push", async () => {
		cachedSettings = { polling: { off: { projectPrList: true } } };
		renderHook(() => useTaskPrBadges({ tasks, discoverProjectIds }));
		await advance(10 * 60_000);
		expect(getProjectPRs).not.toHaveBeenCalled();

		act(() => {
			window.dispatchEvent(new CustomEvent("rpc:globalSettingsUpdated", { detail: { polling: undefined } }));
		});
		await advance(0);
		expect(getProjectPRs).toHaveBeenCalledTimes(2);
	});
});
