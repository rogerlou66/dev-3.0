import type { Task } from "../../shared/types";
import { ALL_STATUSES, computeTaskTimeBreakdown } from "../../shared/types";
import { canBlockTask, effectiveTaskColumn, isTaskBlocked } from "../../shared/task-blocking";
import { isAttentionTask } from "../utils/taskFacets";
import { matchesTaskQuery, type TaskQueryContext } from "../utils/taskSearch";
import { groupTasksIntoTiers } from "../components/sidebarTiers";

const task: Task = { id: "hold", seq: 1, projectId: "p1", title: "Waiting review", description: "", status: "review-by-user", baseBranch: "main", branchName: "topic", worktreePath: "/tmp/work", groupId: null, variantIndex: null, agentId: null, configId: null, createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z" };
const context: TaskQueryContext = { agentName: null, labelNames: [], priorityValue: "p3", isAttention: true, hasPort: false, statusValues: ["review-by-user"], spaceNames: null };

describe("blocked projection", () => {
	it("does not introduce a persisted lifecycle status", () => expect(ALL_STATUSES).not.toContain("blocked"));
	it("keeps legacy tasks in their status or custom column", () => {
		expect(effectiveTaskColumn(task)).toBe("review-by-user");
		expect(effectiveTaskColumn({ ...task, customColumnId: "qa" })).toBe("custom");
	});
	it("takes precedence over custom placement without destroying it", () => {
		expect(effectiveTaskColumn({ ...task, customColumnId: "qa", blocked: true })).toBe("blocked");
	});
	it.each(["todo", "completed", "cancelled"] as const)("ignores stale flags on %s", (status) => {
		expect(isTaskBlocked({ ...task, status, blocked: true })).toBe(false);
	});
	it("only offers blocking for settled reviews", () => {
		expect(canBlockTask(task)).toBe(true);
		expect(canBlockTask({ ...task, status: "review-by-colleague" })).toBe(true);
		expect(canBlockTask({ ...task, preparing: true })).toBe(false);
		expect(canBlockTask({ ...task, status: "in-progress" })).toBe(false);
	});
	it("removes held reviews from Needs You and keeps them in a separate sidebar tier", () => {
		const held = { ...task, blocked: true };
		expect(isAttentionTask(held)).toBe(false);
		expect(groupTasksIntoTiers([held], { scope: "global", sortOrder: "oldest-first", orderedCustomColumns: [] })).toMatchObject([{ kind: "blocked", tasks: [held] }]);
	});
	it.each(["is:blocked", "status:blocked"])("matches %s only for blocked tasks", (query) => {
		expect(matchesTaskQuery({ ...task, blocked: true }, query, context)).toBe(true);
		expect(matchesTaskQuery(task, query, context)).toBe(false);
		expect(matchesTaskQuery({ ...task, blocked: true }, "is:attention", context)).toBe(false);
	});
	it("does not count live blocked waiting as human review time", () => {
		const result = computeTaskTimeBreakdown({ ...task, blocked: true, statusEnteredAt: task.createdAt, statusDurations: { "review-by-user": 5000 } }, Date.parse(task.createdAt) + 60000);
		expect(result.userMs).toBe(5000);
	});
});
