import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalHandle } from "../TerminalView";
import {
	__resetAndroidClientBridgeForTests,
	appendAndroidDraft,
	androidTerminalContextKey,
	bindAndroidTerminal,
	getAndroidDeviceCapabilities,
	installAndroidClientBridge,
	isAndroidAppHost,
	isAndroidAppShell,
	requestAndroidDevice,
	type AndroidWebMessageEvent,
	type AndroidWebMessagePort,
} from "../android-client-bridge";

function makePort() {
	let listener: ((event: AndroidWebMessageEvent) => void) | null = null;
	const sent: unknown[] = [];
	const port: AndroidWebMessagePort = {
		postMessage: (message) => sent.push(JSON.parse(message)),
		addEventListener: (_type, next) => { listener = next; },
		removeEventListener: (_type, next) => { if (listener === next) listener = null; },
	};
	return {
		port,
		sent,
		deliver: async (payload: unknown) => {
			listener?.({ data: JSON.stringify(payload) });
			await Promise.resolve();
			await Promise.resolve();
		},
	};
}

function makeHandle(): TerminalHandle {
	return {
		sendInput: vi.fn(),
		paste: vi.fn(),
		submit: vi.fn(),
		focus: vi.fn(),
		blur: vi.fn(),
		claimWriter: vi.fn(),
	};
}

describe("android client bridge", () => {
	beforeEach(() => {
		__resetAndroidClientBridgeForTests();
		delete window.__DEV3_ANDROID_APP__;
		delete window.dev3Android;
	});

	it("detects the Android shell before its native message port is ready", () => {
		expect(isAndroidAppShell()).toBe(false);
		expect(isAndroidAppHost()).toBe(false);
		window.__DEV3_ANDROID_APP__ = true;
		expect(isAndroidAppShell()).toBe(true);
		expect(isAndroidAppHost()).toBe(false);
		window.dev3Android = makePort().port;
		expect(isAndroidAppHost()).toBe(true);
	});

	it("announces the bridge and active terminal context", () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		installAndroidClientBridge();
		const unbind = bindAndroidTerminal(
			{ kind: "task", taskId: "task-1", projectId: "project-1", rawMode: false },
			makeHandle(),
			vi.fn().mockResolvedValue("delivered"),
		);

		expect(native.sent).toEqual([
			{ type: "bridge-ready", version: 1 },
			{ type: "terminal-context", context: { kind: "task", taskId: "task-1", projectId: "project-1", rawMode: false } },
		]);
		unbind();
		expect(native.sent[native.sent.length - 1]).toEqual({ type: "terminal-context", context: null });
	});

	it("keeps submit asynchronous and acknowledges success", async () => {
		const native = makePort();
		const submit = vi.fn().mockResolvedValue("delivered");
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		bindAndroidTerminal(
			{ kind: "task", taskId: "task-1", projectId: "project-1", rawMode: false },
			makeHandle(),
			submit,
		);

		await native.deliver({ type: "submit", requestId: "request-1", contextKey: "task:project-1:task-1", text: "Fix the tests" });
		expect(submit).toHaveBeenCalledWith("Fix the tests");
		expect(native.sent[native.sent.length - 1]).toEqual({
			type: "command-result",
			requestId: "request-1",
			ok: true,
			deliveryStatus: "delivered",
		});
	});

	it("forwards remote-session expiry before a terminal is open", () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		installAndroidClientBridge();
		window.dispatchEvent(new CustomEvent("rpc:authFailed"));
		expect(native.sent[native.sent.length - 1]).toEqual({ type: "auth-failed" });
	});

	it("preserves an explicit unconfirmed delivery verdict", async () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		bindAndroidTerminal(
			{ kind: "task", taskId: "task-1", projectId: "project-1", rawMode: false },
			makeHandle(),
			vi.fn().mockResolvedValue("unconfirmed"),
		);
		await native.deliver({ type: "submit", requestId: "maybe", contextKey: "task:project-1:task-1", text: "Check me" });
		expect(native.sent[native.sent.length - 1]).toEqual({
			type: "command-result",
			requestId: "maybe",
			ok: false,
			deliveryStatus: "unconfirmed",
			error: "Prompt delivery unconfirmed",
		});
	});

	it("forwards connection and Back state to the Android shell", () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		installAndroidClientBridge();
		window.dispatchEvent(new CustomEvent("dev3:rpcStatus", { detail: { state: "connected" } }));
		expect(native.sent[native.sent.length - 1]).toEqual({ type: "connection-state", state: "connected" });
		window.dispatchEvent(new CustomEvent("dev3:backOutcome", { detail: { outcome: "route-back" } }));
		expect(native.sent[native.sent.length - 1]).toEqual({ type: "back-outcome", outcome: "route-back" });
	});

	it("uses the terminal paste path for Insert", async () => {
		const native = makePort();
		const handle = makeHandle();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		bindAndroidTerminal(
			{ kind: "project", projectId: "project-1", rawMode: false },
			handle,
			vi.fn().mockResolvedValue("delivered"),
		);

		await native.deliver({ type: "insert", requestId: "request-2", contextKey: "project:project-1", text: "pwd" });
		expect(handle.paste).toHaveBeenCalledWith("pwd");
		expect(native.sent[native.sent.length - 1]).toEqual({
			type: "command-result",
			requestId: "request-2",
			ok: true,
			deliveryStatus: "unconfirmed",
		});
	});

	it("preserves the native draft when delivery fails or raw mode is active", async () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		bindAndroidTerminal(
			{ kind: "task", taskId: "task-1", projectId: "project-1", rawMode: false },
			makeHandle(),
			vi.fn().mockRejectedValue(new Error("No live agent")),
		);
		await native.deliver({ type: "submit", requestId: "request-3", contextKey: "task:project-1:task-1", text: "Keep me" });
		expect(native.sent[native.sent.length - 1]).toEqual({
			type: "command-result",
			requestId: "request-3",
			ok: false,
			deliveryStatus: "unconfirmed",
			error: "No live agent",
		});

		bindAndroidTerminal(
			{ kind: "task", taskId: "task-1", projectId: "project-1", rawMode: true },
			makeHandle(),
			vi.fn(),
		);
		await native.deliver({ type: "submit", requestId: "request-4", contextKey: "task:project-1:task-1", text: "Keep me too" });
		expect(native.sent[native.sent.length - 1]).toEqual({
			type: "command-result",
			requestId: "request-4",
			ok: false,
			deliveryStatus: "not-delivered",
			error: "Terminal is in raw mode",
		});
	});

	it("rejects a stale task context and appends attachments to the native draft", async () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		const context = { kind: "task", taskId: "task-1", projectId: "project-1", rawMode: false } as const;
		bindAndroidTerminal(context, makeHandle(), vi.fn().mockResolvedValue("delivered"));
		await native.deliver({ type: "submit", requestId: "stale", contextKey: "task:project-1:task-2", text: "wrong task" });
		expect(native.sent[native.sent.length - 1]).toEqual({
			type: "command-result",
			requestId: "stale",
			ok: false,
			deliveryStatus: "not-delivered",
			error: "Terminal context changed",
		});

		appendAndroidDraft(context, "uploads/screenshot.png ");
		expect(native.sent[native.sent.length - 1]).toEqual({
			type: "append-draft",
			contextKey: androidTerminalContextKey(context),
			text: "uploads/screenshot.png ",
		});
	});

	it("round-trips device requests with reload-safe ids", async () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		installAndroidClientBridge();
		const request = requestAndroidDevice<{ value: string }>("example", { input: 1 });
		const packet = native.sent[native.sent.length - 1] as { requestId: string };
		expect(packet.requestId).toMatch(/^device-[a-z0-9]+-1$/);
		await native.deliver({ type: "device-result", requestId: packet.requestId, ok: true, payload: { value: "done" } });
		await expect(request).resolves.toEqual({ value: "done" });
	});

	it("stores native capability updates", async () => {
		const native = makePort();
		window.__DEV3_ANDROID_APP__ = true;
		window.dev3Android = native.port;
		installAndroidClientBridge();
		await native.deliver({
			type: "device-capabilities",
			capabilities: {
				version: 1,
				notificationPermission: "granted",
				clipboardImage: true,
				fileSave: true,
				externalOpen: true,
			},
		});
		expect(getAndroidDeviceCapabilities()?.notificationPermission).toBe("granted");
	});
});
