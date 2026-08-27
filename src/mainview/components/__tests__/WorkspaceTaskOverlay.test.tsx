import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project, Task } from "../../../shared/types";
import { I18nProvider } from "../../i18n";
import { __resetBackLayersForTests, closeTopBackLayer } from "../../back-navigation";
import WorkspaceTaskOverlay from "../WorkspaceTaskOverlay";

const getTasks = vi.fn();

vi.mock("../../rpc", () => ({
	api: { request: { getTasks: (params: { projectId: string }) => getTasks(params) } },
}));

vi.mock("../TaskWorkspaceView", () => ({
	default: ({ taskId }: { taskId: string }) => (
		<div>
			<div data-testid="workspace-view">workspace:{taskId}</div>
			<button data-terminal="true">terminal</button>
		</div>
	),
}));

const project: Project = {
	id: "p1",
	name: "Alpha",
	path: "/tmp/alpha",
	setupScript: "",
	devScript: "",
	cleanupScript: "",
	defaultBaseBranch: "main",
	createdAt: "2026-01-01T00:00:00Z",
};

const task: Task = {
	id: "t1",
	projectId: "p1",
	seq: 7,
	title: "Fix the overlay",
	description: "Fix the overlay",
	status: "in-progress",
	baseBranch: "main",
	worktreePath: "/tmp/wt",
	branchName: "codex/overlay",
	groupId: null,
	variantIndex: null,
	agentId: null,
	configId: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};

function renderOverlay(overrides?: Partial<React.ComponentProps<typeof WorkspaceTaskOverlay>>) {
	const props: React.ComponentProps<typeof WorkspaceTaskOverlay> = {
		projectId: "p1",
		taskId: "t1",
		tasks: [task],
		projects: [project],
		dispatch: vi.fn(),
		navigate: vi.fn(),
		onRequestClose: vi.fn(),
		onOpenFullPage: vi.fn(),
		onTaskMissing: vi.fn(),
		...overrides,
	};
	return { props, ...render(<I18nProvider><WorkspaceTaskOverlay {...props} /></I18nProvider>) };
}

describe("WorkspaceTaskOverlay", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		__resetBackLayersForTests();
		getTasks.mockResolvedValue([task]);
	});

	it("renders cached task context immediately and refreshes the project cache", async () => {
		const dispatch = vi.fn();
		renderOverlay({ dispatch });

		expect(screen.getByRole("dialog", { name: "Alpha / #7 / Fix the overlay" })).toBeInTheDocument();
		expect(screen.getByTestId("workspace-view")).toHaveTextContent("workspace:t1");
		await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "setTasks", projectId: "p1", tasks: [task] }));
		expect(getTasks).toHaveBeenCalledTimes(1);
	});

	it("supports full-page, close, and backdrop dismissal", async () => {
		const onOpenFullPage = vi.fn();
		const onRequestClose = vi.fn();
		renderOverlay({ onOpenFullPage, onRequestClose });

		await userEvent.click(screen.getByRole("button", { name: "Open full page" }));
		expect(onOpenFullPage).toHaveBeenCalledOnce();
		fireEvent.pointerDown(screen.getByRole("dialog"));
		expect(onRequestClose).not.toHaveBeenCalled();
		fireEvent.pointerDown(screen.getByTestId("workspace-task-overlay"));
		expect(onRequestClose).toHaveBeenCalledOnce();
		await userEvent.click(screen.getByRole("button", { name: "Close task workspace" }));
		expect(onRequestClose).toHaveBeenCalledTimes(2);
	});

	it("keeps Escape inside the terminal and closes from outside or Back", () => {
		const onRequestClose = vi.fn();
		renderOverlay({ onRequestClose });
		const terminal = screen.getByRole("button", { name: "terminal" });
		terminal.focus();
		const terminalTab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
		window.dispatchEvent(terminalTab);
		expect(terminalTab.defaultPrevented).toBe(false);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onRequestClose).not.toHaveBeenCalled();

		screen.getByRole("button", { name: "Open full page" }).focus();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onRequestClose).toHaveBeenCalledOnce();
		expect(closeTopBackLayer()).toBe(true);
		expect(onRequestClose).toHaveBeenCalledTimes(2);
	});

	it("reports a task removed during refresh", async () => {
		const onTaskMissing = vi.fn();
		getTasks.mockResolvedValue([]);
		renderOverlay({ onTaskMissing });

		await waitFor(() => expect(onTaskMissing).toHaveBeenCalledOnce());
	});
});
