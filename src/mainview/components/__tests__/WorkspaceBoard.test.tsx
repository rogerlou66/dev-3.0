import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspaceBoard from "../WorkspaceBoard";
import { I18nProvider } from "../../i18n";
import type { Project, Task } from "../../../shared/types";

vi.mock("../../rpc", () => ({
	api: { request: {
		getWorkspaceBoardTasks: vi.fn(),
		setTaskBlocked: vi.fn(),
		moveTask: vi.fn(),
		getAgents: vi.fn().mockResolvedValue([]),
		getGlobalSettings: vi.fn().mockResolvedValue({ defaultAgentId: "builtin-claude", defaultConfigId: "claude-default", taskSortOrder: "oldest-first", updateChannel: "stable" }),
	} },
}));

vi.mock("../TaskCard", () => ({
	default: ({ task, project, onOpenWorkspaceTask, onDragStart }: { task: Task; project: Project; onOpenWorkspaceTask?: (task: Task, project: Project, trigger: HTMLElement) => void; onDragStart?: (id: string) => void }) => (
		<button
			draggable
			onDragStart={() => onDragStart?.(task.id)}
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

	it("loads a blocked review in its own cell, never in Inbox or Your Review", async () => {
		const held = { ...task("external-wait", "p1", "review-by-user"), blocked: true };
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([{ projectId: "p1", tasks: [held] }]);
		render(<I18nProvider><WorkspaceBoard projects={[projects[0]]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);
		expect(await screen.findByTestId("workspace-cell-p1-blocked")).toHaveTextContent("external-wait");
		expect(screen.getByRole("region", { name: "Inbox" })).not.toHaveTextContent("external-wait");
		expect(screen.getByTestId("workspace-cell-p1-review-by-user")).not.toHaveTextContent("external-wait");
	});

	it("restores an unblocked review to Inbox after a live push", async () => {
		const held = { ...task("external-wait", "p1", "review-by-user"), blocked: true };
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([{ projectId: "p1", tasks: [held] }]);
		render(<I18nProvider><WorkspaceBoard projects={[projects[0]]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);
		await screen.findByTestId("workspace-cell-p1-blocked");
		await act(async () => window.dispatchEvent(new CustomEvent("rpc:taskUpdated", { detail: { projectId: "p1", task: { ...held, blocked: false } } })));
		expect(screen.getByRole("region", { name: "Inbox" })).toHaveTextContent("external-wait");
		expect(screen.getByTestId("workspace-cell-p1-blocked")).not.toHaveTextContent("external-wait");
	});

	it("accepts review drops into Blocked only in the same project", async () => {
		const review = task("review-drag", "p1", "review-by-user");
		vi.mocked(api.request.setTaskBlocked).mockResolvedValue({ ...review, blocked: true });
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([{ projectId: "p1", tasks: [review] }, { projectId: "p2", tasks: [task("other", "p2", "in-progress")] }]);
		render(<I18nProvider><WorkspaceBoard projects={projects} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);
		const card = await screen.findByTestId("workspace-task-review-drag");
		await act(async () => card.dispatchEvent(new Event("dragstart", { bubbles: true })));
		await act(async () => screen.getByTestId("workspace-cell-p2-blocked").dispatchEvent(new Event("drop", { bubbles: true })));
		expect(api.request.setTaskBlocked).not.toHaveBeenCalled();
		await act(async () => screen.getByTestId("workspace-cell-p1-blocked").dispatchEvent(new Event("drop", { bubbles: true })));
		await waitFor(() => expect(api.request.setTaskBlocked).toHaveBeenCalledWith({ projectId: "p1", taskId: review.id, blocked: true }));
		expect(screen.getByRole("region", { name: "Inbox" })).not.toHaveTextContent("review-drag");
	});

	it("dragging a blocked review back to the same review stage clears the hold", async () => {
		const review = { ...task("return-review", "p1", "review-by-user"), blocked: true };
		vi.mocked(api.request.moveTask).mockResolvedValue({ ...review, blocked: false });
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([{ projectId: "p1", tasks: [review] }]);
		render(<I18nProvider><WorkspaceBoard projects={[projects[0]]} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);
		const card = await screen.findByTestId("workspace-task-return-review");
		await act(async () => card.dispatchEvent(new Event("dragstart", { bubbles: true })));
		await act(async () => screen.getByTestId("workspace-cell-p1-review-by-user").dispatchEvent(new Event("drop", { bubbles: true })));
		await waitFor(() => expect(api.request.moveTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: review.id, newStatus: "review-by-user", clearBlocked: true })));
	});

	it("keeps every project visible and projects Questions into Agent Working", async () => {
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: [task("question", "p1", "user-questions"), task("done", "p1", "completed")] },
			{ projectId: "p2", tasks: [] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={projects} query="" dispatch={vi.fn()} navigate={vi.fn()} bellCounts={new Map()} onOpenCreateTask={vi.fn()} /></I18nProvider>);

		expect(await screen.findByRole("region", { name: "Alpha" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "Beta" })).toBeInTheDocument();
		expect(screen.getByTestId("workspace-task-question")).toHaveAttribute("data-needs-input", "true");
		expect(screen.getByRole("region", { name: "Inbox" })).toHaveTextContent("Has Questions");
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

	it("collects questions and Your Review work in Inbox without removing their grid cards", async () => {
		const onOpenWorkspaceTask = vi.fn();
		const navigate = vi.fn();
		const question = { ...task("question-inbox", "p1", "user-questions"), priority: "P1" as const, worktreePath: "/tmp/question" };
		const review = { ...task("review-inbox", "p2", "review-by-user"), priority: "P2" as const, worktreePath: "/tmp/review" };
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "p1", tasks: [question] },
			{ projectId: "p2", tasks: [review] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={projects} query="" dispatch={vi.fn()} navigate={navigate} bellCounts={new Map()} onOpenCreateTask={vi.fn()} onOpenWorkspaceTask={onOpenWorkspaceTask} /></I18nProvider>);

		const inbox = await screen.findByRole("region", { name: "Inbox" });
		expect(inbox).toHaveClass("h-32");
		expect(within(inbox).getByTitle("Questions and reviews waiting on you")).toHaveClass("w-10");
		expect(within(inbox).getByTestId("workspace-inbox-rail")).toHaveClass("-rotate-90");
		expect(screen.getByTestId("workspace-kanban-scroll")).not.toContainElement(inbox);
		expect(within(inbox).getByText("question-inbox")).toBeInTheDocument();
		expect(within(inbox).getByText("review-inbox")).toBeInTheDocument();
		expect(screen.getByTestId("workspace-task-question-inbox")).toBeInTheDocument();
		expect(screen.getByTestId("workspace-task-review-inbox")).toBeInTheDocument();

		await userEvent.click(within(inbox).getByRole("button", { name: "Answer" }));
		expect(onOpenWorkspaceTask).toHaveBeenCalledWith(projects[0], question, [question], expect.any(HTMLElement));
		await userEvent.click(within(inbox).getByRole("button", { name: "Open" }));
		expect(navigate).toHaveBeenCalledWith({ screen: "task", projectId: "p1", taskId: "question-inbox" });
		expect(within(inbox).getByRole("button", { name: "PR Review" })).toBeInTheDocument();
	});

	it("marks PR Review unavailable for virtual projects", async () => {
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([{ projectId: "p1", tasks: [task("working", "p1", "in-progress")] }]);
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

	it("pins Operations and leaves project names as the only open-project control", async () => {
		const onReorderProjects = vi.fn();
		const navigate = vi.fn();
		const operations: Project = { ...projects[0], id: "ops", name: "Operations", kind: "virtual", builtin: true };
		vi.mocked(api.request.getWorkspaceBoardTasks).mockResolvedValue([
			{ projectId: "ops", tasks: [] },
			{ projectId: "p1", tasks: [] },
			{ projectId: "p2", tasks: [] },
		]);

		render(<I18nProvider><WorkspaceBoard projects={[projects[0], operations, projects[1]]} query="" dispatch={vi.fn()} navigate={navigate} bellCounts={new Map()} onOpenCreateTask={vi.fn()} onReorderProjects={onReorderProjects} /></I18nProvider>);

		const operationsRow = await screen.findByRole("region", { name: "Operations" });
		const alphaRow = screen.getByRole("region", { name: "Alpha" });
		expect(within(operationsRow).queryByRole("button", { name: /Move project/ })).not.toBeInTheDocument();
		expect(within(alphaRow).queryByRole("button", { name: /Move project/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Open project" })).not.toBeInTheDocument();
		await userEvent.click(within(alphaRow).getByRole("button", { name: "Alpha" }));
		expect(navigate).toHaveBeenCalledWith({ screen: "project", projectId: "p1" });
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
		act(() => window.dispatchEvent(new CustomEvent("rpc:taskUpdated", {
			detail: { projectId: "p1", task: task("created-live", "p1", "todo") },
		})));
		expect(await screen.findByText("created-live")).toBeInTheDocument();
	});

	it("keeps completed tasks behind a compact per-project count and expands them independently", async () => {
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
		expect(within(alpha).queryByText("done-4")).not.toBeInTheDocument();
		expect(within(alpha).queryByText("done-3")).not.toBeInTheDocument();
		expect(within(alpha).queryByText("done-2")).not.toBeInTheDocument();
		expect(within(alpha).queryByText("done-1")).not.toBeInTheDocument();
		expect(within(beta).queryByText("beta-done-3")).not.toBeInTheDocument();
		expect(within(beta).queryByText("beta-done-2")).not.toBeInTheDocument();
		expect(within(beta).queryByText("beta-done-1")).not.toBeInTheDocument();

		const doneCount = within(alpha).getByRole("button", { name: "✓ 4" });
		expect(doneCount).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(doneCount);

		expect(within(alpha).getByText("done-4")).toBeInTheDocument();
		expect(within(alpha).getByText("done-3")).toBeInTheDocument();
		expect(within(alpha).getByText("done-2")).toBeInTheDocument();
		expect(within(alpha).getByText("done-1")).toBeInTheDocument();
		expect(within(alpha).getByRole("button", { name: "Show less" })).toBeInTheDocument();
		expect(within(beta).queryByText("beta-done-1")).not.toBeInTheDocument();
		expect(within(beta).getByRole("button", { name: "✓ 3" })).toHaveAttribute("aria-expanded", "false");
	});
});
