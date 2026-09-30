import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodingAgent, Project, Task } from "../shared/types";
import { getTaskTitle, MAX_SCHEDULED_MESSAGE_LENGTH } from "../shared/types";
import type { AgentPromptDeliveryStatus } from "../shared/agent-prompt-delivery";
import { parseEventCursor } from "../shared/board-events";
import { atomicWriteFile } from "./atomic-write";
import { withFileLock } from "./file-lock";

type Params = Record<string, unknown>;
export interface IntegrationDependencies {
	home: string;
	projects(): Promise<Project[]>;
	agents(): Promise<CodingAgent[]>;
	project(id: string): Promise<Project>;
	task(project: Project, id: string): Promise<Task>;
	create(input: { projectId: string; title: string; description: string; reservationId: string }): Promise<Task>;
	launch(input: { projectId: string; taskId: string; agentId: string; configId: string }): Promise<Task>;
	message(input: { projectId: string; taskId: string; text: string; subject: string }): Promise<{ status: AgentPromptDeliveryStatus; detail?: string }>;
	events(input: Params): Promise<unknown>;
}

interface Receipt {
	version: 1;
	fingerprint: string;
	taskId: string;
	state: "reserved" | "created" | "dispatching" | "dispatched";
	delivery?: { status: AgentPromptDeliveryStatus; detail?: string };
}

function required(input: Params, key: string, max = 512): string {
	const value = input[key];
	if (typeof value !== "string" || !value.trim() || value.length > max) {
		throw new Error(`${key} must be a non-empty string of at most ${max} characters`);
	}
	return value.trim();
}

function fields(input: Params, allowed: string[]): void {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a JSON object");
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key)) throw new Error(`Unknown integration field: ${key}`);
	}
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function integrationTask(task: Task) {
	return {
		id: task.id, projectId: task.projectId, seq: task.seq ?? null,
		title: getTaskTitle(task), description: task.description, status: task.status,
		runtimeState: task.runtimeState ?? null, preparing: task.preparing ?? false,
		preparationError: task.preparationError ?? null, blocked: task.blocked ?? false,
		hibernated: task.hibernated ?? false, draft: task.draft ?? false,
		agentId: task.agentId, configId: task.configId,
		prUrl: task.prUrl ?? null, prStatusCache: task.prStatusCache ?? null,
		overview: task.userOverview ?? task.overview ?? null, notes: task.notes ?? [],
		createdAt: task.createdAt, updatedAt: task.updatedAt,
	};
}

export function createIntegration(deps: IntegrationDependencies) {
	const directory = join(deps.home, "integration-v1");

	async function receipt(path: string): Promise<Receipt | null> {
		let raw: string;
		try { raw = await readFile(path, "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		const value = JSON.parse(raw) as Receipt;
		if (value.version !== 1 || typeof value.fingerprint !== "string" || typeof value.taskId !== "string"
			|| !["reserved", "created", "dispatching", "dispatched"].includes(value.state)) {
			throw new Error("Invalid integration receipt; refusing to repeat an uncertain operation");
		}
		return value;
	}

	async function locked<T>(name: string, run: (path: string) => Promise<T>): Promise<T> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const path = join(directory, `${name}.json`);
		return withFileLock(path, () => run(path));
	}

	const save = (path: string, value: Receipt) => atomicWriteFile(path, JSON.stringify(value));

	return {
		capabilities: async (input: Params) => {
			fields(input, []);
			return {
				protocolVersion: 1,
				commands: ["capabilities", "projects", "agents", "create", "launch", "message", "show", "events"],
				createIdempotency: "durable", launchIdempotency: "at-most-once",
				messageIdempotency: "at-most-once",
				launchRequiresConfirmation: true, eventKinds: ["note", "move"],
				eventRetention: "bounded; persist events and reconcile tasks",
			};
		},
		projects: async (input: Params) => {
			fields(input, []);
			return { projects: (await deps.projects()).map((p) => ({ id: p.id, name: p.name, path: p.path, kind: p.kind ?? "git" })) };
		},
		agents: async (input: Params) => {
			fields(input, []);
			return { agents: (await deps.agents()).map((a) => ({
				id: a.id, name: a.name, defaultConfigId: a.defaultConfigId ?? null,
				configurations: a.configurations.map((c) => ({ id: c.id, name: c.name, model: c.model ?? null })),
			})) };
		},
		create: async (input: Params) => {
			fields(input, ["projectId", "title", "description", "idempotencyKey"]);
			const projectId = required(input, "projectId");
			const title = required(input, "title", 1000);
			const description = required(input, "description", 100_000);
			const key = required(input, "idempotencyKey", 256);
			const project = await deps.project(projectId);
			const fingerprint = hash({ projectId, title, description, key });
			return locked(`create-${hash({ projectId, key })}`, async (path) => {
				let record = await receipt(path);
				const replayed = record !== null;
				if (record && record.fingerprint !== fingerprint) throw new Error("Idempotency key already used with different content");
				if (!record) {
					record = { version: 1, fingerprint, taskId: randomUUID(), state: "reserved" };
					await save(path, record);
				}
				const task = record.state === "created"
					? await deps.task(project, record.taskId)
					: await deps.create({ projectId, title, description, reservationId: record.taskId });
				record.state = "created";
				await save(path, record);
				return { task: integrationTask(task), replayed, operationState: "created" };
			});
		},
		launch: async (input: Params) => {
			fields(input, ["projectId", "taskId", "agentId", "configId", "idempotencyKey", "confirmed"]);
			if (input.confirmed !== true) throw new Error("Launching requires confirmed: true from an explicit user action");
			const projectId = required(input, "projectId");
			const taskId = required(input, "taskId");
			const agentId = required(input, "agentId");
			const configId = required(input, "configId");
			const key = required(input, "idempotencyKey", 256);
			const project = await deps.project(projectId);
			const fingerprint = hash({ projectId, taskId, agentId, configId, key });
			return locked(`launch-${hash({ projectId, taskId })}`, async (path) => {
				const previous = await receipt(path);
				const task = await deps.task(project, taskId);
				if (previous) {
					if (previous.fingerprint !== fingerprint) throw new Error("This task already has an integration launch; inspect it in dev3 before another launch");
					return { task: integrationTask(task), replayed: true, operationState: previous.state === "dispatched" ? "dispatched" : "uncertain" };
				}
				if (task.status !== "todo" || task.draft || task.hibernated || task.preparing || task.worktreePath) {
					throw new Error("Only an unstarted, non-draft To Do task can be launched through integration");
				}
				const agent = (await deps.agents()).find((a) => a.id === agentId);
				if (!agent?.configurations.some((c) => c.id === configId)) throw new Error("Unknown agent or configuration; refresh the agent list");
				const record: Receipt = { version: 1, fingerprint, taskId, state: "dispatching" };
				await save(path, record);
				const launched = await deps.launch({ projectId, taskId, agentId, configId });
				record.state = "dispatched";
				await save(path, record);
				return { task: integrationTask(launched), replayed: false, operationState: "dispatched" };
			});
		},
		message: async (input: Params) => {
			fields(input, ["projectId", "taskId", "text", "idempotencyKey", "confirmed"]);
			if (input.confirmed !== true) throw new Error("Sending context requires confirmed: true from an explicit user action");
			const projectId = required(input, "projectId");
			const taskId = required(input, "taskId");
			const text = required(input, "text", MAX_SCHEDULED_MESSAGE_LENGTH);
			const key = required(input, "idempotencyKey", 256);
			const project = await deps.project(projectId);
			await deps.task(project, taskId);
			const fingerprint = hash({ projectId, taskId, text, key });
			return locked(`message-${hash({ projectId, taskId, key })}`, async (path) => {
				const previous = await receipt(path);
				if (previous && previous.fingerprint !== fingerprint) throw new Error("Idempotency key already used with different context");
				const record: Receipt = previous ?? { version: 1, fingerprint, taskId, state: "dispatching" };
				if (!previous) {
					await save(path, record);
					record.delivery = await deps.message({ projectId, taskId, text, subject: "Topic context update" });
					record.state = "dispatched";
					await save(path, record);
				}
				const status = record.delivery?.status ?? "unconfirmed";
				return {
					taskId, projectId, status, delivered: status === "delivered", queued: status === "held",
					replayed: previous !== null, operationState: record.state === "dispatched" ? "dispatched" : "uncertain",
					...(record.delivery?.detail ? { detail: record.delivery.detail } : {}),
				};
			});
		},
		show: async (input: Params) => {
			fields(input, ["projectId", "taskId"]);
			return { task: integrationTask(await deps.task(await deps.project(required(input, "projectId")), required(input, "taskId"))) };
		},
		events: async (input: Params) => {
			fields(input, ["projectId", "cursor", "limit"]);
			const params: Params = {};
			if (input.projectId !== undefined) params.projectId = required(input, "projectId");
			if (input.cursor !== undefined && input.cursor !== null) {
				const raw = required(input, "cursor");
				const cursor = /^\d{4}-\d{2}-\d{2}T/.test(raw) ? parseEventCursor(raw) : null;
				if (!cursor) throw new Error("Invalid event cursor");
				params.cursor = cursor;
			}
			if (input.limit !== undefined) {
				if (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 1000) throw new Error("limit must be an integer from 1 to 1000");
				params.limit = input.limit;
			}
			return deps.events(params);
		},
	};
}
