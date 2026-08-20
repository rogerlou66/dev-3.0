import { render, screen, waitFor } from "@testing-library/react";
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
	default: ({ task }: { task: Task }) => <div data-testid={`workspace-task-${task.id}`} data-needs-input={task.status === "user-questions" || undefined}>{task.title}</div>,
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
});
