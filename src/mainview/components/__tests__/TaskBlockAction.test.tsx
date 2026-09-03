import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "../../../shared/types";
import TaskBlockAction from "../TaskBlockAction";
import { I18nProvider } from "../../i18n";
import { api } from "../../rpc";

vi.mock("../../rpc", () => ({ api: { request: { setTaskBlocked: vi.fn() } } }));
const task: Task = { id: "review", projectId: "p1", seq: 1, title: "Review", description: "", status: "review-by-user", createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", baseBranch: "main", worktreePath: "/tmp/work", branchName: "topic", groupId: null, variantIndex: null, agentId: null, configId: null };

describe("TaskBlockAction", () => {
	beforeEach(() => vi.clearAllMocks());
	it("blocks through the shared RPC and updates without launching anything", async () => {
		const dispatch = vi.fn();
		vi.mocked(api.request.setTaskBlocked).mockResolvedValue({ ...task, blocked: true });
		render(<I18nProvider><TaskBlockAction task={task} dispatch={dispatch} onClose={vi.fn()} /></I18nProvider>);
		await userEvent.click(screen.getByRole("button", { name: "Move to Blocked" }));
		await waitFor(() => expect(api.request.setTaskBlocked).toHaveBeenCalledWith({ projectId: "p1", taskId: "review", blocked: true }));
		expect(dispatch).toHaveBeenLastCalledWith({ type: "updateTask", task: { ...task, blocked: true } });
	});
	it("unblocks without moving the underlying review stage", async () => {
		vi.mocked(api.request.setTaskBlocked).mockResolvedValue(task);
		render(<I18nProvider><TaskBlockAction task={{ ...task, blocked: true }} dispatch={vi.fn()} onClose={vi.fn()} /></I18nProvider>);
		await userEvent.click(screen.getByRole("button", { name: "Unblock task" }));
		expect(api.request.setTaskBlocked).toHaveBeenCalledWith({ projectId: "p1", taskId: "review", blocked: false });
	});
	it("rolls back a failed request", async () => {
		const dispatch = vi.fn();
		vi.mocked(api.request.setTaskBlocked).mockRejectedValue(new Error("Disconnected"));
		render(<I18nProvider><TaskBlockAction task={task} dispatch={dispatch} onClose={vi.fn()} /></I18nProvider>);
		await userEvent.click(screen.getByRole("button", { name: "Move to Blocked" }));
		await waitFor(() => expect(dispatch).toHaveBeenLastCalledWith({ type: "updateTask", task }));
	});
	it("does not offer blocking for a task still being worked on", () => {
		render(<I18nProvider><TaskBlockAction task={{ ...task, status: "in-progress" }} dispatch={vi.fn()} onClose={vi.fn()} /></I18nProvider>);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});
});
