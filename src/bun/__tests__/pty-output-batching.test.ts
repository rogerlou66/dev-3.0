import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		accessSync: vi.fn(),
		existsSync: vi.fn(() => true),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
		lstatSync: vi.fn(() => { throw new Error("ENOENT"); }),
		statSync: vi.fn(() => ({ isFile: () => true })),
		readlinkSync: vi.fn(() => { throw new Error("EINVAL"); }),
		realpathSync: vi.fn((path: string) => path),
		unlinkSync: vi.fn(),
		symlinkSync: vi.fn(),
	};
});

vi.mock("../spawn", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));

import { spawn, spawnSync } from "../spawn";
import { ptyOutputRecorder } from "../freeze-diagnostics/pty-output";

interface WsHandlers {
	open(ws: unknown): void;
	close(ws: unknown): void;
}

let wsHandlers: WsHandlers;
const bun = globalThis as unknown as { Bun: { serve: (config: unknown) => unknown } };
const stubServe = bun.Bun.serve;
bun.Bun.serve = (config: unknown) => {
	const websocket = (config as { websocket?: WsHandlers }).websocket;
	if (websocket) wsHandlers = websocket;
	return stubServe(config);
};

const pty = await import("../pty-server");
const { createSession, destroySession, hasSession } = pty;
const BATCH_MS = 16;

class FakeClient {
	readonly sent: string[] = [];
	readonly data: { url: URL };

	constructor(sessionId: string) {
		this.data = { url: new URL(`http://localhost/?session=${sessionId}`) };
	}

	sendText(text: string): void {
		this.sent.push(text);
	}
}

const mockSpawn = vi.mocked(spawn);
const mockSpawnSync = vi.mocked(spawnSync);
let emit: (data: string) => void;
const activeSessions: string[] = [];

function startSession(taskId: string): FakeClient {
	activeSessions.push(taskId);
	createSession(taskId, "proj-1", "/tmp/cwd", "bash", {});
	const client = new FakeClient(taskId);
	wsHandlers.open(client);
	return client;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mockSpawnSync.mockReturnValue({ exitCode: 0, stdout: new Uint8Array(0) } as never);
	mockSpawn.mockImplementation(((_cmd: unknown, opts: { terminal?: { data?: unknown } }) => {
		const onData = opts?.terminal?.data as ((terminal: unknown, data: string) => void) | undefined;
		if (onData) emit = (data: string) => onData(null, data);
		return {
			pid: 100,
			terminal: { close: vi.fn(), resize: vi.fn(), write: vi.fn() },
			kill: vi.fn(),
			exited: new Promise(() => {}),
		};
	}) as never);
});

afterEach(() => {
	for (const id of activeSessions) {
		if (hasSession(id)) destroySession(id);
	}
	activeSessions.length = 0;
	vi.useRealTimers();
});

describe("PTY output batching", () => {
	it("coalesces a burst and preserves byte order", () => {
		const client = startSession("task-batch-1");

		emit("a");
		emit("b");
		emit("c");
		expect(client.sent).toEqual([]);

		vi.advanceTimersByTime(BATCH_MS);
		expect(client.sent).toEqual(["abc"]);
	});
});

describe("freeze capture recording", () => {
	afterEach(() => ptyOutputRecorder.setEnabled(false));

	it("keeps no terminal output while freeze capture is off", () => {
		startSession("task-freeze-off-1");
		emit("private output");
		vi.advanceTimersByTime(BATCH_MS);
		expect(ptyOutputRecorder.snapshot()).toEqual([]);
	});

	it("records exactly the frames a viewer was sent, in order, and forgets the viewer on close", () => {
		ptyOutputRecorder.setEnabled(true);
		const client = startSession("task-freeze-rec-1");
		for (let i = 0; i < 20; i++) {
			emit(`chunk${i}|`);
			vi.advanceTimersByTime(5);
		}
		vi.advanceTimersByTime(BATCH_MS);

		const [record] = ptyOutputRecorder.snapshot();
		expect(client.sent.length).toBeGreaterThan(1);
		expect(record!.chunks.map((chunk) => chunk.text)).toEqual(client.sent);
		expect(record!.sessionKey).toBe("task-freeze-rec-1");

		wsHandlers.close(client);
		expect(ptyOutputRecorder.snapshot()).toEqual([]);
	});
});
