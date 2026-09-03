import type { Task, TaskStatus } from "./types";

export type TaskBoardColumn = TaskStatus | "blocked" | "custom";
type BlockingTask = Pick<Task, "status" | "blocked">;

export function isTaskBlocked(task: BlockingTask): boolean {
	return task.blocked === true && !["todo", "completed", "cancelled"].includes(task.status);
}

export function canBlockTask(task: Pick<Task, "status" | "preparing" | "shuttingDown" | "draft" | "runtimeState">): boolean {
	return ["review-by-user", "review-by-colleague"].includes(task.status)
		&& !task.preparing && !task.shuttingDown && !task.draft
		&& task.runtimeState?.runtime !== "preparing" && task.runtimeState?.runtime !== "tearing-down";
}

/** Blocked takes precedence over both the saved status and custom placement. */
export function effectiveTaskColumn(task: BlockingTask & Pick<Task, "customColumnId">): TaskBoardColumn {
	if (isTaskBlocked(task)) return "blocked";
	return task.customColumnId ? "custom" : task.status;
}

export const BLOCKED_COLORS = { dark: "#f5b5d4", light: "#a3256a" } as const;
