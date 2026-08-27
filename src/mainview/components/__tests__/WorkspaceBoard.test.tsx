import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspaceBoard from "../WorkspaceBoard";
import { I18nProvider } from "../../i18n";
import type { Project, Task } from "../../../shared/types";

vi.mock("../../rpc", () => ({
	api: { request: {
		getWorkspaceBoardTasks: vi.fn(),
		getAgents: vi.fn().mockResolvedValue([]),
		getGlobalSettings: vi.fn().mockResolvedValue({ defaultAgentId: "builtin-claude", defaultConfigId: "claude-default", taskSortOrder: "oldest-first", updateChannel: "stable" }),
	} },
}));

vi.mock("../TaskCard", () => ({
	default: ({ task, project, onOpenWorkspaceTask }: { task: Task; project: Project; onOpenWorkspaceTask?: (task: Task, project: Project, trigger: HTMLElement) => void }) => (
		<button
			data-testid={`workspace-task-${task.id}`}
			data-needs-input={task.status === "user-questions" || undefined}
			onClick={(event) => onOpenWorkspaceTask?.(task, project, event.currentTarget)}
		>
			{task.title}
		</button>
	),
}));

vi.mock("../LaunchVariantsModal", () => ({ default: () => null }));

import { api } from "../../rpc";

const projects: Project[] = [
	{ id: "p1", name: "Alpha", path: "/tmp/alpha", setupScript: "", devScript: "", cleanupScript: "", defaultBaseBranch: "main", createdAt: "2026-01-01T00:00:00Z" },
	{ id: "p2", name: "Beta", path: "/tmp/beta", setupScript: "", devScript: "", cleanupScript: "", defaultBaseBranch: "main", createdAt: "2026-01-01T00:00:00Z" },
];

function task(id: string, projectId: string, status: Task["status"]): Task {
	return { id, projectId, seq: 1, title: id, description: id, status, baseBranch: "main", worktreePath: null, branchName: null, groupId: null, variantIndex: null, agentId: null, configId: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}

describe("WorkspaceBoard", () => {
	beforeEach(() => vi.clearAllMocks());

	it("keeps every project visible and projects Questions into Agent Working", async () => {
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: [task("question", "p1", "user-questions"), task("done", "p1", "completed")] },
			{ projectId: "p2", tasks: [] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={projects} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);

		expect(await screen.findByText("Alpha")).toBeInTheDocument();
		expect(screen.getByText("Beta")).toBeInTheDocument();
		expect(screen.getByText("question")).toHaveAttribute("data-needs-input", "true");
		expect(screen.queryByText("Has Questions")).not.toBeInTheDocument();
		expect(screen.queryByText("AI Review")).not.toBeInTheDocument();
		expect(screen.getByText("PR Review")).toBeInTheDocument();
		expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
	});

	it("opens AI Review only while occupied and keeps PR Review visible", async () => {
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: [task("ai", "p1", "review-by-ai"), task("pr", "p1", "review-by-colleague")] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={[projects[0]]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);

		await waitFor(() => expect(screen.getByText("AI Review")).toBeInTheDocument());
		expect(screen.getByText("PR Review")).toBeInTheDocument();
	});

	it("marks PR Review unavailable for virtual projects", async () => {
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([{ projectId: "p1", tasks: [] }]);
		const virtualProject = { ...projects[0], kind: "virtual" as const };

		render(<I18nProvider><WorkspaceBoard projects={[virtualProject]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);

		await screen.findByText("Alpha");
		expect(screen.getByText("PR Review")).toBeInTheDocument();
		expect(screen.getByText("N/A")).toBeInTheDocument();
	});

	it("opens task creation for the project owning the To Do cell", async () => {
		const onOpenCreateTask = vi.fn();
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: [] },
			{ projectId: "p2", tasks: [] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={projects} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={onOpenCreateTask} /></I18nProvider>);

		await screen.findByText("Alpha");
		await userEvent.click(screen.getAllByRole("button", { name: "+ New Task" })[1]);
		expect(onOpenCreateTask).toHaveBeenCalledWith("p2");
	});

	it("reorders whole project swimlanes from the project drag handle", async () => {
		const onReorderProjects = vi.fn();
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: [] },
			{ projectId: "p2", tasks: [] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={projects} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} onReorderProjects={onReorderProjects} /></I18nProvider>);

		await screen.findByText("Alpha");
		const betaHandle = screen.getAllByTitle("Drag to reorder project")[1];
		const alphaRow = screen.getByRole("region", { name: "Alpha" });
		const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
		vi.spyOn(alphaRow, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
		fireEvent.dragStart(betaHandle, { dataTransfer });
		fireEvent.dragOver(alphaRow, { clientY: 25, dataTransfer });
		fireEvent.drop(alphaRow, { clientY: 25, dataTransfer });

		expect(onReorderProjects).toHaveBeenCalledWith(["p2", "p1"]);
	});

	it("pins Operations and exposes step controls as the non-drag path", async () => {
		const onReorderProjects = vi.fn();
		const operations: Project = { ...projects[0], id: "ops", name: "Operations", kind: "virtual", builtin: true };
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "ops", tasks: [] },
			{ projectId: "p1", tasks: [] },
			{ projectId: "p2", tasks: [] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={[projects[0], operations, projects[1]]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} onReorderProjects={onReorderProjects} /></I18nProvider>);

		const operationsRow = await screen.findByRole("region", { name: "Operations" });
		const alphaRow = screen.getByRole("region", { name: "Alpha" });
		expect(within(operationsRow).getByRole("button", { name: "Move project down" })).toBeDisabled();
		expect(within(alphaRow).getByRole("button", { name: "Move project up" })).toBeDisabled();
		await userEvent.click(within(alphaRow).getByRole("button", { name: "Move project down" }));
		expect(onReorderProjects).toHaveBeenCalledWith(["ops", "p2", "p1"]);
	});

	it("hands an active task and its project cache to the workspace overlay host", async () => {
		const onOpenWorkspaceTask = vi.fn();
		const active = { ...task("active", "p1", "in-progress"), worktreePath: "/tmp/active" };
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([{ projectId: "p1", tasks: [active] }]);

		render(<I18nProvider><WorkspaceBoard projects={[projects[0]]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} onOpenWorkspaceTask={onOpenWorkspaceTask} /></I18nProvider>);
		const trigger = await screen.findByTestId("workspace-task-active");
		await userEvent.click(trigger);

		expect(onOpenWorkspaceTask).toHaveBeenCalledWith(projects[0], active, [active], trigger);
	});

	it("shows a newly created task from the live update without remounting", async () => {
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: [] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={[projects[0]]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);

		await screen.findByText("Alpha");
		expect(screen.queryByText("created-live")).not.toBeInTheDocument();
		window.dispatchEvent(new CustomEvent("rpc:taskUpdated", {
			detail: { projectId: "p1", task: task("created-live", "p1", "todo") },
		}));
		expect(await screen.findByText("created-live")).toBeInTheDocument();
	});

	it("shows the two newest completed tasks and expands the rest per project", async () => {
		const completedTasks = [1, 2, 3, 4].map((index) => ({
			...task(`done-${index}`, "p1", "completed"),
			movedAt: `2026-01-0${index}T00:00:00Z`,
		}));
		const betaCompletedTasks = [1, 2, 3].map((index) => ({
			...task(`beta-done-${index}`, "p2", "completed"),
			movedAt: `2026-01-0${index}T00:00:00Z`,
		}));
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: completedTasks },
			{ projectId: "p2", tasks: betaCompletedTasks },
		]);

		render(<I18nProvider><WorkspaceBoard projects={projects} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);

		const alpha = await screen.findByRole("region", { name: "Alpha" });
		const beta = screen.getByRole("region", { name: "Beta" });
		expect(within(alpha).getByText("done-4")).toBeInTheDocument();
		expect(within(alpha).getByText("done-3")).toBeInTheDocument();
		expect(within(alpha).queryByText("done-2")).not.toBeInTheDocument();
		expect(within(alpha).queryByText("done-1")).not.toBeInTheDocument();
		expect(within(beta).getByText("beta-done-3")).toBeInTheDocument();
		expect(within(beta).getByText("beta-done-2")).toBeInTheDocument();
		expect(within(beta).queryByText("beta-done-1")).not.toBeInTheDocument();

		const showMore = within(alpha).getByRole("button", { name: "Show more (2)" });
		expect(showMore).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(showMore);

		expect(within(alpha).getByText("done-2")).toBeInTheDocument();
		expect(within(alpha).getByText("done-1")).toBeInTheDocument();
		expect(within(alpha).getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
		expect(within(beta).queryByText("beta-done-1")).not.toBeInTheDocument();
		expect(within(beta).getByRole("button", { name: "Show more (1)" })).toHaveAttribute("aria-expanded", "false");
	});
});
