import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import type { Project, TaskStatus } from "../../shared/types";
import { computeTaskTimeBreakdown } from "../../shared/types";

const TEST_HOME = vi.hoisted(() => `${process.env.DEV3_TEST_ROOT}/data-blocked`);
vi.mock("../paths", () => ({ DEV3_HOME: TEST_HOME }));
vi.mock("../logger", () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { addTask, getTask, updateTask } from "../data";

const project: Project = { id: "blocked-project", name: "Blocked test", path: "/tmp/blocked-project", setupScript: "", devScript: "", cleanupScript: "", defaultBaseBranch: "main", createdAt: "2026-09-02T00:00:00Z" };
const start = Date.parse("2026-09-02T00:00:00Z");
const minute = 60_000;

beforeEach(() => {
	rmSync(TEST_HOME, { recursive: true, force: true });
	mkdirSync(TEST_HOME, { recursive: true });
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(start);
});
afterEach(() => vi.useRealTimers());

describe("persisted task blocking", () => {
	it("keeps status, workspace, priority and unknown additive fields across reload", async () => {
		const task = await addTask(project, "Review", "review-by-user");
		await updateTask(project, task.id, { worktreePath: "/tmp/preserved", priority: "P1", hibernated: true });
		await updateTask(project, task.id, { blocked: true });
		expect(await getTask(project, task.id)).toMatchObject({ blocked: true, blockedAt: new Date(start).toISOString(), status: "review-by-user", worktreePath: "/tmp/preserved", priority: "P1", hibernated: true });
	});

	it("keeps a hold through hook/PR updates and separates blocked time from review time", async () => {
		const task = await addTask(project, "Review", "review-by-user");
		vi.setSystemTime(start + minute);
		await updateTask(project, task.id, { blocked: true });
		vi.setSystemTime(start + 3 * minute);
		const promoted = await updateTask(project, task.id, { status: "review-by-colleague" });
		expect(promoted.blocked).toBe(true);
		expect(promoted.blockedAt).toBe(new Date(start + minute).toISOString());
		expect(computeTaskTimeBreakdown(promoted, start + 8 * minute).userMs).toBe(minute);
		vi.setSystemTime(start + 5 * minute);
		const unblocked = await updateTask(project, task.id, { blocked: false });
		expect(unblocked).toMatchObject({ blocked: false, blockedAt: null, status: "review-by-colleague", blockedDurationMs: 4 * minute });
		expect(computeTaskTimeBreakdown(unblocked, start + 6 * minute).userMs).toBe(2 * minute);
	});

	it.each(["todo", "in-progress", "user-questions", "review-by-ai", "completed", "cancelled"] as TaskStatus[])("rejects blocking %s at the locked write boundary", async (status) => {
		const task = await addTask(project, "Cannot block", status);
		await expect(updateTask(project, task.id, { blocked: true })).rejects.toThrow("Only settled review tasks");
		expect((await getTask(project, task.id)).blocked).toBeUndefined();
	});

	it.each(["todo", "completed", "cancelled"] as TaskStatus[])("clears the hold when moved to %s", async (status) => {
		const task = await addTask(project, "Review", "review-by-user");
		await updateTask(project, task.id, { blocked: true });
		vi.setSystemTime(start + minute);
		await updateTask(project, task.id, { status });
		expect(await getTask(project, task.id)).toMatchObject({ status, blocked: false, blockedAt: null, blockedDurationMs: minute });
	});

	it("repeated block requests keep the original waiting clock", async () => {
		const task = await addTask(project, "Review", "review-by-user");
		await updateTask(project, task.id, { blocked: true });
		vi.setSystemTime(start + minute);
		await updateTask(project, task.id, { blocked: true });
		expect((await getTask(project, task.id)).blockedAt).toBe(new Date(start).toISOString());
	});
});
