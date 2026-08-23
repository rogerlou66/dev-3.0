import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "../i18n";
import { activateTerminalPath } from "../terminal-path-open";

const runtime = vi.hoisted(() => ({ isElectrobun: false, androidApp: false }));
const openTerminalPath = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("../rpc", () => ({
	get isElectrobun() {
		return runtime.isElectrobun;
	},
	api: {
		request: {
			getGlobalSettings: vi.fn(),
			openTerminalPath,
		},
	},
}));

vi.mock("../android-client-bridge", () => ({
	isAndroidAppHost: () => runtime.androidApp,
}));

vi.mock("../toast", () => ({
	toast: {
		info: toastInfo,
		success: toastSuccess,
		error: vi.fn(),
	},
}));

const t = ((key: string) => key) as TFunction;

describe("activateTerminalPath on Android", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtime.isElectrobun = false;
		runtime.androidApp = false;
	});

	it("keeps a generic remote browser from opening a host directory invisibly", async () => {
		await activateTerminalPath({ kind: "directory", path: "/worktree/docs" }, t, undefined, "task-1");

		expect(openTerminalPath).not.toHaveBeenCalled();
		expect(toastInfo).toHaveBeenCalledWith("terminal.pathLinkFolderBrowser", {
			taskId: "task-1",
			source: "terminal",
		});
	});

	it("opens a directory on the paired computer and confirms where it opened", async () => {
		runtime.androidApp = true;
		openTerminalPath.mockResolvedValue(undefined);

		await activateTerminalPath({ kind: "directory", path: "/worktree/docs" }, t, undefined, "task-1");

		expect(openTerminalPath).toHaveBeenCalledWith({ path: "/worktree/docs", mode: "system" });
		expect(toastSuccess).toHaveBeenCalledWith("terminal.pathLinkOpenedOnComputer", {
			taskId: "task-1",
			source: "terminal",
		});
	});

	it("still previews files on the tablet instead of opening them invisibly on the host", async () => {
		runtime.androidApp = true;
		const received: unknown[] = [];
		window.addEventListener("dev3:openFilePreview", (event) => received.push((event as CustomEvent).detail), { once: true });

		await activateTerminalPath({ kind: "file", path: "/worktree/readme.md" }, t, 12, "task-1");

		expect(openTerminalPath).not.toHaveBeenCalled();
		expect(received).toEqual([{ path: "/worktree/readme.md", line: 12, taskId: "task-1" }]);
	});
});
