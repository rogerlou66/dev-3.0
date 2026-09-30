import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegration, type IntegrationDependencies } from "../integration";
import type { CodingAgent, Project, Task } from "../../shared/types";

let home: string;
let tasks: Map<string, Task>;
let deps: IntegrationDependencies;
const project = { id: "project-1", name: "Example", path: "/example", env: { SECRET: "private" } } as unknown as Project;
const agent = {
	id: "agent-1", name: "Example agent", baseCommand: "secret-command", providerConfig: { apiKey: "secret" },
	configurations: [{ id: "config-1", name: "Example preset", model: "example", env: { TOKEN: "secret" } }],
} as unknown as CodingAgent;
const createInput = { projectId: project.id, title: "Fix the issue", description: "Reviewed context", idempotencyKey: "topic:revision:1" };
const launchInput = (id: string) => ({ projectId: project.id, taskId: id, agentId: agent.id, configId: "config-1", idempotencyKey: "launch:1", confirmed: true });

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "dev3-integration-"));
	tasks = new Map();
	deps = {
		home,
		projects: async () => [project], agents: async () => [agent],
		project: async (id) => { if (id !== project.id) throw new Error("Project not found"); return project; },
		task: async (_project, id) => { const task = tasks.get(id); if (!task) throw new Error("Task not found"); return task; },
		create: vi.fn(async ({ reservationId, title, description }) => {
			if (!tasks.has(reservationId)) tasks.set(reservationId, {
				id: reservationId, projectId: project.id, title, description, status: "todo",
				agentId: null, configId: null, worktreePath: null,
			} as Task);
			return tasks.get(reservationId)!;
		}),
		launch: vi.fn(async ({ taskId, agentId, configId }) => {
			const task = { ...tasks.get(taskId)!, status: "in-progress" as const, preparing: true, agentId, configId };
			tasks.set(taskId, task);
			return task;
		}),
		events: vi.fn(async (params) => ({ events: [], cursor: params.cursor ?? null })),
		message: vi.fn(async () => ({ status: "held" as const, detail: "Waiting for an idle pane" })),
	};
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe("local integration", () => {
	it("returns safe project and agent metadata without commands or credentials", async () => {
		const api = createIntegration(deps);
		expect(await api.projects({})).toEqual({ projects: [{ id: project.id, name: "Example", path: "/example", kind: "git" }] });
		expect(await api.agents({})).toEqual({ agents: [{ id: agent.id, name: agent.name, defaultConfigId: null, configurations: [{ id: "config-1", name: "Example preset", model: "example" }] }] });
	});
	it("creates in To Do without starting an agent", async () => {
		const result = await createIntegration(deps).create(createInput);
		expect(result.task.status).toBe("todo");
		expect(deps.launch).not.toHaveBeenCalled();
	});
	it("replays a lost create response after service restart without creating again", async () => {
		const first = await createIntegration(deps).create(createInput);
		const retried = await createIntegration(deps).create(createInput);
		expect(retried).toMatchObject({ task: { id: first.task.id }, replayed: true, operationState: "created" });
		expect(deps.create).toHaveBeenCalledTimes(1);
	});
	it("recovers a crash after task persistence using the reserved UUID", async () => {
		const persist = deps.create;
		deps.create = vi.fn(async (input) => { await persist(input); throw new Error("process lost before receipt"); });
		await expect(createIntegration(deps).create(createInput)).rejects.toThrow("process lost");
		const id = [...tasks.keys()][0];
		deps.create = persist;
		const retried = await createIntegration(deps).create(createInput);
		expect(retried.task.id).toBe(id);
		expect(tasks.size).toBe(1);
	});
	it("serializes concurrent creates for the same key", async () => {
		const results = await Promise.all(Array.from({ length: 4 }, () => createIntegration(deps).create(createInput)));
		expect(new Set(results.map((r) => r.task.id)).size).toBe(1);
		expect(deps.create).toHaveBeenCalledTimes(1);
	});
	it("refuses a key reused for different content", async () => {
		const api = createIntegration(deps);
		await api.create(createInput);
		await expect(api.create({ ...createInput, description: "Changed" })).rejects.toThrow("different content");
	});
	it("never recreates a task deleted after a successful receipt", async () => {
		const api = createIntegration(deps);
		await api.create(createInput);
		tasks.clear();
		await expect(api.create(createInput)).rejects.toThrow("Task not found");
		expect(deps.create).toHaveBeenCalledTimes(1);
	});
	it("fails closed on a corrupt receipt", async () => {
		const api = createIntegration(deps);
		await api.create(createInput);
		const directory = join(home, "integration-v1");
		await writeFile(join(directory, (await readdir(directory))[0]), "broken");
		await expect(api.create(createInput)).rejects.toThrow();
		expect(deps.create).toHaveBeenCalledTimes(1);
	});
	it("launches exactly the selected agent and preset once across retries", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		const first = await api.launch(launchInput(task.id));
		const replay = await createIntegration(deps).launch(launchInput(task.id));
		expect(first).toMatchObject({ operationState: "dispatched", task: { agentId: agent.id, configId: "config-1", preparing: true } });
		expect(replay.replayed).toBe(true);
		expect(deps.launch).toHaveBeenCalledExactlyOnceWith({ projectId: project.id, taskId: task.id, agentId: agent.id, configId: "config-1" });
	});
	it("does not repeat an uncertain launch after an execution error", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		deps.launch = vi.fn(async () => { throw new Error("connection lost during launch"); });
		await expect(api.launch(launchInput(task.id))).rejects.toThrow("connection lost");
		expect(await createIntegration(deps).launch(launchInput(task.id))).toMatchObject({ replayed: true, operationState: "uncertain" });
		expect(deps.launch).toHaveBeenCalledTimes(1);
	});
	it("serializes simultaneous launches of the same task", async () => {
		const { task } = await createIntegration(deps).create(createInput);
		await Promise.all(Array.from({ length: 4 }, () => createIntegration(deps).launch(launchInput(task.id))));
		expect(deps.launch).toHaveBeenCalledTimes(1);
	});
	it("prevents a new key from launching an already dispatched task", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		await api.launch(launchInput(task.id));
		await expect(api.launch({ ...launchInput(task.id), idempotencyKey: "another" })).rejects.toThrow("already has an integration launch");
	});
	it("requires an explicit confirmation value", async () => {
		await expect(createIntegration(deps).launch({ ...launchInput("t"), confirmed: false })).rejects.toThrow("confirmed: true");
		expect(deps.launch).not.toHaveBeenCalled();
	});
	it("rejects unknown agent configurations before dispatch", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		await expect(api.launch({ ...launchInput(task.id), configId: "missing" })).rejects.toThrow("Unknown agent");
		expect(deps.launch).not.toHaveBeenCalled();
	});
	it.each(["draft", "hibernated", "preparing"])("does not activate a %s task", async (property) => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		Object.assign(tasks.get(task.id)!, { [property]: true });
		await expect(api.launch(launchInput(task.id))).rejects.toThrow("Only an unstarted");
	});
	it("reads results without inferring success from a column", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		Object.assign(tasks.get(task.id)!, { status: "completed", prUrl: "https://example.test/pr/1", notes: [{ content: "Test failure" }] });
		expect(await api.show({ projectId: project.id, taskId: task.id })).toMatchObject({ task: { status: "completed", notes: [{ content: "Test failure" }] } });
	});

	it("queues confirmed context using the existing delivery contract and deduplicates after restart", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		const input = { projectId: project.id, taskId: task.id, text: "New context `echo unsafe`\n$(do not execute)", idempotencyKey: "context:1", confirmed: true };
		const response = await api.message(input);
		expect(response).toMatchObject({ status: "held", queued: true, delivered: false, replayed: false });
		expect(await createIntegration(deps).message(input)).toMatchObject({ status: "held", replayed: true });
		expect(deps.message).toHaveBeenCalledExactlyOnceWith({ projectId: project.id, taskId: task.id, text: input.text, subject: "Topic context update" });
	});

	it("never resends context whose outcome was lost", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		const input = { projectId: project.id, taskId: task.id, text: "Context", idempotencyKey: "context:1", confirmed: true };
		deps.message = vi.fn(async () => { throw new Error("Lost response after sending"); });
		await expect(api.message(input)).rejects.toThrow("Lost response");
		expect(await createIntegration(deps).message(input)).toMatchObject({ status: "unconfirmed", operationState: "uncertain", delivered: false, queued: false });
		expect(deps.message).toHaveBeenCalledTimes(1);
	});

	it("serializes duplicate context requests while allowing a new reviewed update", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		const input = { projectId: project.id, taskId: task.id, text: "Context", idempotencyKey: "context:1", confirmed: true };
		await Promise.all([api.message(input), createIntegration(deps).message(input)]);
		expect(deps.message).toHaveBeenCalledTimes(1);
		await api.message({ ...input, text: "More context", idempotencyKey: "context:2" });
		expect(deps.message).toHaveBeenCalledTimes(2);
	});

	it("rejects unconfirmed context and key reuse with edited content", async () => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		const input = { projectId: project.id, taskId: task.id, text: "Context", idempotencyKey: "context:1", confirmed: true };
		await expect(api.message({ ...input, confirmed: false })).rejects.toThrow("confirmed: true");
		await api.message(input);
		await expect(api.message({ ...input, text: "Different" })).rejects.toThrow("different context");
		expect(deps.message).toHaveBeenCalledTimes(1);
	});

	it.each(["delivered", "unconfirmed", "not-delivered"] as const)("preserves the %s context delivery outcome", async (status) => {
		const api = createIntegration(deps);
		const { task } = await api.create(createInput);
		deps.message = vi.fn(async () => ({ status }));
		expect(await api.message({ projectId: project.id, taskId: task.id, text: "Context", idempotencyKey: "context:1", confirmed: true })).toMatchObject({ status, delivered: status === "delivered", queued: false });
	});
	it("validates cursor and forwards bounded event requests", async () => {
		const api = createIntegration(deps);
		await expect(api.events({ cursor: "bad" })).rejects.toThrow("cursor");
		await expect(api.events({ limit: 0 })).rejects.toThrow("limit");
		await api.events({ cursor: "2026-09-30T10:00:00.000", limit: 10 });
		expect(deps.events).toHaveBeenCalledWith({ cursor: "2026-09-30T10:00:00.000Z", limit: 10 });
	});
	it("rejects unexpected fields instead of silently running an unintended request", async () => {
		await expect(createIntegration(deps).create({ ...createInput, run: true })).rejects.toThrow("Unknown integration field");
		expect(deps.create).not.toHaveBeenCalled();
	});
});
