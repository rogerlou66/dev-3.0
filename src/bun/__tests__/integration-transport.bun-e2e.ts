#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Project } from "../../shared/types";

// Real CLI, listener, receipts, and task persistence; agent execution is a recorded test boundary.
const root = await mkdtemp(join(tmpdir(), "dev3-integration-wire-"));
process.env.DEV3_HOME = root;
const { createIntegration } = await import("../integration");
const { startCliListener } = await import("../cli-listener");
const { spawn } = await import("../spawn");
const data = await import("../data");
const project: Project = {
	id: "integration-test-project", name: "Integration transport test", path: join(root, "repository"),
	setupScript: "", devScript: "", cleanupScript: "", defaultBaseBranch: "main", createdAt: new Date().toISOString(),
};
const launches: unknown[] = [];
const messages: unknown[] = [];
const dependencies = {
	home: root,
	projects: async () => [project],
	agents: async () => [{ id: "test-agent", name: "Test agent", baseCommand: "never-executed", configurations: [{ id: "test-preset", name: "Test preset" }] }],
	project: async (id: string) => { assert.equal(id, project.id); return project; },
	task: (owner: Project, id: string) => data.getTask(owner, id),
	create: async (input: { title: string; description: string; reservationId: string }) => data.addTask(project, input.description, "todo", { title: input.title, reservationId: input.reservationId }),
	launch: async (input: { taskId: string; agentId: string; configId: string }) => {
		launches.push(input);
		return data.updateTask(project, input.taskId, { agentId: input.agentId, configId: input.configId, status: "in-progress" });
	},
	message: async (input: { text: string }) => { messages.push(input); return { status: "held" as const }; },
	events: async () => ({ events: [], cursor: null, droppedNewer: 0 }),
};
let api = createIntegration(dependencies);
const sockets = join(root, "sockets");
await mkdir(sockets, { recursive: true });
const listener = startCliListener({
	socketsDir: sockets, pid: process.pid, hostTaskId: null, transport: process.platform === "win32" ? "tcp" : "unix",
	handle: async (request) => {
		try {
			const name = request.method.replace(/^integration\./, "") as keyof typeof api;
			if (!Object.prototype.hasOwnProperty.call(api, name)) throw new Error("Unknown method");
			return { id: request.id, ok: true, data: await api[name](request.params) };
		} catch (error) { return { id: request.id, ok: false, error: String(error) }; }
	},
});

async function command(name: string, input?: object): Promise<Record<string, any>> {
	const child = spawn([process.execPath, resolve(import.meta.dir, "../../cli/main.ts"), "integration", name, ...(input ? ["--json", "-"] : [])], {
		cwd: root, env: { DEV3_HOME: root, DEV3_CLI_SOCKET: listener.endpoint },
		stdin: new TextEncoder().encode(input ? JSON.stringify(input) : ""), stdout: "pipe", stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	assert.equal(code, 0, stderr);
	return JSON.parse(stdout);
}

try {
	assert.equal((await command("capabilities")).protocolVersion, 1);
	const input = { projectId: project.id, title: "Transport fixture", description: "A test-only prompt", idempotencyKey: "wire-create" };
	const first = await command("create", input);
	assert.equal(first.task.status, "todo");
	assert.equal(first.task.agentId, null);
	assert.equal(launches.length, 0);
	api = createIntegration(dependencies);
	const replay = await command("create", input);
	assert.equal(replay.task.id, first.task.id);
	assert.equal(replay.replayed, true);
	assert.equal((await data.loadTasks(project)).length, 1);
	const launch = { projectId: project.id, taskId: first.task.id, agentId: "test-agent", configId: "test-preset", idempotencyKey: "wire-launch", confirmed: true };
	await command("launch", launch);
	await command("launch", launch);
	assert.deepEqual(launches, [{ projectId: project.id, taskId: first.task.id, agentId: "test-agent", configId: "test-preset" }]);
	const context = { projectId: project.id, taskId: first.task.id, text: "Literal $(text) `text`\nSecond line", idempotencyKey: "wire-context", confirmed: true };
	assert.equal((await command("message", context)).queued, true);
	assert.equal((await command("message", context)).replayed, true);
	assert.equal(messages.length, 1);
	assert.equal((messages[0] as { text: string }).text, context.text);
	const shown = await command("show", { projectId: project.id, taskId: first.task.id });
	assert.equal(shown.task.agentId, "test-agent");
	console.log("PASS: real CLI/socket JSON round trips, durable create replay, chosen launch and context dedup; agent execution stubbed");
} finally {
	listener.stop();
	await rm(root, { recursive: true, force: true });
}
