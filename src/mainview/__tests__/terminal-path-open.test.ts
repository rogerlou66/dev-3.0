import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../rpc";
import { toast } from "../toast";
import type { TFunction } from "../i18n";
import { activateOsc8Uri, OPEN_FILE_PREVIEW_EVENT, type OpenFilePreviewDetail, activateTerminalPath } from "../terminal-path-open";

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
			resolveTerminalPaths: vi.fn(),
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

const resolveTerminalPaths = api.request.resolveTerminalPaths as unknown as ReturnType<typeof vi.fn>;

function previewed(): Promise<OpenFilePreviewDetail> {
	return new Promise((resolve) => {
		window.addEventListener(
			OPEN_FILE_PREVIEW_EVENT,
			(event) => resolve((event as CustomEvent<OpenFilePreviewDetail>).detail),
			{ once: true },
		);
	});
}

describe("activateOsc8Uri", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("opens a resolved file URI through the backend gate, carrying the line", async () => {
		resolveTerminalPaths.mockResolvedValue({ resolved: { "/repo/src/a.ts": { path: "/repo/src/a.ts", kind: "file" } } });
		const detail = previewed();
		await activateOsc8Uri("file:///repo/src/a.ts:12:5", { t, taskId: "task-1", projectId: "proj-1" });
		expect(resolveTerminalPaths).toHaveBeenCalledWith({ taskId: "task-1", projectId: "proj-1", paths: ["/repo/src/a.ts"] });
		expect(await detail).toEqual({ path: "/repo/src/a.ts", line: 12, taskId: "task-1" });
	});

	it("says so when the backend refuses the path, and opens nothing", async () => {
		resolveTerminalPaths.mockResolvedValue({ resolved: { "/etc/passwd": null } });
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		await activateOsc8Uri("file:///etc/passwd", { t });
		expect(open).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("terminal.fileLinkNotFound"), expect.anything());
		open.mockRestore();
	});

	it("never hands a file URI to window.open when it cannot become a path", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		await activateOsc8Uri("file:///tmp/%zz", { t });
		expect(open).not.toHaveBeenCalled();
		expect(resolveTerminalPaths).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("terminal.fileLinkUnreadable"), expect.anything());
		open.mockRestore();
	});

	it("opens a non-file URI externally", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		await activateOsc8Uri("https://example.com/pr/1", { t });
		expect(open).toHaveBeenCalledWith("https://example.com/pr/1", "_blank", "noopener,noreferrer");
		expect(resolveTerminalPaths).not.toHaveBeenCalled();
		open.mockRestore();
	});

	it("reports a failed resolve instead of throwing into the click handler", async () => {
		resolveTerminalPaths.mockRejectedValue(new Error("rpc down"));
		await activateOsc8Uri("file:///repo/a.ts", { t });
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("terminal.pathLinkOpenFailed"), expect.anything());
	});
});
