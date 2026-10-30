import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { BranchStatus, GlobalSettings, Project, Task } from "../../../../shared/types";
import { I18nProvider } from "../../../i18n";
import { clearBranchStatusCache } from "../branchStatusCache";
import { useTaskBranchStatus } from "../useTaskBranchStatus";

const getBranchStatus = vi.fn();
const offerMergeCompletion = vi.fn();
let cachedSettings: Partial<GlobalSettings> | null = null;

vi.mock("../../../rpc", () => ({
	api: { request: { getBranchStatus: (...args: unknown[]) => getBranchStatus(...args) } },
}));

vi.mock("../../../global-settings-cache", () => ({
	getCachedGlobalSettings: () => cachedSettings,
}));

vi.mock("../../../toast", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

vi.mock("../../../utils/offerMergeCompletion", () => ({
	offerMergeCompletion: (...args: unknown[]) => offerMergeCompletion(...args),
}));

const project = { id: "project-1", defaultBaseBranch: "main" } as Project;
const task = { id: "task-poll", status: "review-by-user", worktreePath: "/wt/task-poll", baseBranch: "main" } as Task;

function status(overrides: Partial<BranchStatus> = {}): BranchStatus {
	return { ahead: 1, behind: 0, insertions: 0, deletions: 0, diffFiles: 0, diffInsertions: 0, diffDeletions: 0, ...overrides } as BranchStatus;
}

function wrapper({ children }: { children: ReactNode }) {
	return <I18nProvider>{children}</I18nProvider>;
}

function renderPoll() {
	return renderHook(
		() => useTaskBranchStatus({ task, project, dispatch: vi.fn(), navigate: vi.fn(), isTaskActive: true }),
		{ wrapper },
	);
}

function pushSettings(polling: GlobalSettings["polling"]) {
	act(() => {
		window.dispatchEvent(new CustomEvent("rpc:globalSettingsUpdated", { detail: { polling } }));
	});
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useTaskBranchStatus — Settings → Polling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		clearBranchStatusCache();
		cachedSettings = null;
		getBranchStatus.mockResolvedValue(status());
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls every 15 s (±20% jitter) when nothing is configured", async () => {
		renderPoll();
		await advance(0);
		expect(getBranchStatus).toHaveBeenCalledTimes(1);

		await advance(19_000);
		expect(getBranchStatus).toHaveBeenCalledTimes(2);
	});

	it("uses the configured interval from the first tick", async () => {
		cachedSettings = { polling: { seconds: { branchStatusPoll: 60 } } };
		renderPoll();
		await advance(0);
		expect(getBranchStatus).toHaveBeenCalledTimes(1);

		await advance(40_000);
		expect(getBranchStatus).toHaveBeenCalledTimes(1);

		await advance(40_000);
		expect(getBranchStatus).toHaveBeenCalledTimes(2);
	});

	it("loads once and stops when switched off, while ↻ still asks", async () => {
		cachedSettings = { polling: { off: { branchStatusPoll: true } } };
		const { result } = renderPoll();
		await advance(0);
		expect(getBranchStatus).toHaveBeenCalledTimes(1);
		expect(result.current.branchStatus?.ahead).toBe(1);

		await advance(10 * 60_000);
		expect(getBranchStatus).toHaveBeenCalledTimes(1);

		await act(async () => { await result.current.handleRefreshStatus(); });
		expect(getBranchStatus).toHaveBeenCalledTimes(2);
		expect(getBranchStatus).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
	});

	it("starts polling when a settings push switches it back on", async () => {
		cachedSettings = { polling: { off: { branchStatusPoll: true } } };
		renderPoll();
		await advance(0);
		await advance(60_000);
		expect(getBranchStatus).toHaveBeenCalledTimes(1);

		pushSettings({ seconds: { branchStatusPoll: 30 } });
		await advance(0);
		expect(getBranchStatus).toHaveBeenCalledTimes(2);

		await advance(37_000);
		expect(getBranchStatus).toHaveBeenCalledTimes(3);
	});

	it("does not re-offer an already-offered merge when the setting changes", async () => {
		getBranchStatus.mockResolvedValue(status({ ahead: 0, mergedByContent: true, mergeCompletionFingerprint: "fp-1" }));
		renderPoll();
		await advance(0);
		expect(offerMergeCompletion).toHaveBeenCalledTimes(1);

		pushSettings({ seconds: { branchStatusPoll: 45 } });
		await advance(0);
		expect(getBranchStatus).toHaveBeenCalledTimes(2);
		expect(offerMergeCompletion).toHaveBeenCalledTimes(1);
	});
});
