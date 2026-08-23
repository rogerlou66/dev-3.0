import type { TerminalHandle } from "./TerminalView";
import { RPC_STATUS_EVENT } from "./diagnostics";
import type { AgentPromptDeliveryStatus } from "../shared/agent-prompt-delivery";

export interface AndroidWebMessageEvent {
	data: string;
}

export interface AndroidWebMessagePort {
	postMessage: (message: string) => void;
	addEventListener: (type: "message", listener: (event: AndroidWebMessageEvent) => void) => void;
	removeEventListener: (type: "message", listener: (event: AndroidWebMessageEvent) => void) => void;
}

export interface AndroidDeviceCapabilities {
	version: number;
	notificationPermission: "default" | "granted" | "denied";
	clipboardImage: boolean;
	fileSave: boolean;
	externalOpen: boolean;
}

declare global {
	interface Window {
		__DEV3_ANDROID_APP__?: boolean;
		dev3Android?: AndroidWebMessagePort;
	}
}

export type AndroidTerminalContext =
	| { kind: "task"; taskId: string; projectId: string; rawMode: boolean }
	| { kind: "project"; projectId: string; rawMode: boolean };

interface AndroidTerminalBinding {
	context: AndroidTerminalContext;
	handle: TerminalHandle;
	submit: (text: string) => Promise<AgentPromptDeliveryStatus>;
}

type AndroidCommand =
	| { type: "submit"; requestId: string; contextKey: string; text: string }
	| { type: "insert"; requestId: string; contextKey: string; text: string };

let activeBinding: AndroidTerminalBinding | null = null;
let installedPort: AndroidWebMessagePort | null = null;
let authFailureBound = false;
let deviceRequestSequence = 0;
const deviceRequestEpoch = (() => {
	try {
		const bytes = new Uint32Array(2);
		crypto.getRandomValues(bytes);
		return `${bytes[0].toString(36)}${bytes[1].toString(36)}`;
	} catch {
		return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
	}
})();
let deviceCapabilities: AndroidDeviceCapabilities | null = null;
const pendingDeviceRequests = new Map<string, {
	resolve: (payload: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}>();
let originalClipboardDescriptor: PropertyDescriptor | undefined;
let clipboardPatched = false;
let originalWindowOpen: typeof window.open | null = null;

export function androidTerminalContextKey(context: AndroidTerminalContext): string {
	return context.kind === "task"
		? `task:${context.projectId}:${context.taskId}`
		: `project:${context.projectId}`;
}

function forwardAuthFailure(): void {
	send(installedPort, { type: "auth-failed" });
}

function forwardRpcState(event: Event): void {
	const state = (event as CustomEvent<{ state?: unknown }>).detail?.state;
	if (typeof state === "string") send(installedPort, { type: "connection-state", state });
}

function forwardBackOutcome(event: Event): void {
	const outcome = (event as CustomEvent<{ outcome?: unknown }>).detail?.outcome;
	if (typeof outcome === "string") send(installedPort, { type: "back-outcome", outcome });
}

function send(port: AndroidWebMessagePort | null, payload: unknown): void {
	if (!port) return;
	try {
		port.postMessage(JSON.stringify(payload));
	} catch {
		// Native bridge failures must not break the browser client.
	}
}

function parseCommand(data: string): AndroidCommand | null {
	try {
		const command = JSON.parse(data) as Partial<AndroidCommand>;
		if (
			(command.type !== "submit" && command.type !== "insert") ||
			typeof command.requestId !== "string" || typeof command.contextKey !== "string" || typeof command.text !== "string"
		) {
			return null;
		}
		return command as AndroidCommand;
	} catch {
		return null;
	}
}

async function handleCommand(event: AndroidWebMessageEvent): Promise<void> {
	let packet: Record<string, unknown>;
	try {
		packet = JSON.parse(event.data) as Record<string, unknown>;
	} catch {
		return;
	}

	if (packet.type === "device-result" && typeof packet.requestId === "string") {
		const pending = pendingDeviceRequests.get(packet.requestId);
		if (!pending) return;
		pendingDeviceRequests.delete(packet.requestId);
		clearTimeout(pending.timeout);
		if (packet.ok === true) pending.resolve(packet.payload);
		else pending.reject(new Error(typeof packet.error === "string" ? packet.error : "Android device request failed"));
		return;
	}
	if (packet.type === "device-capabilities" && packet.capabilities && typeof packet.capabilities === "object") {
		deviceCapabilities = packet.capabilities as AndroidDeviceCapabilities;
		installAndroidDevicePolyfills();
		window.dispatchEvent(new CustomEvent("dev3:androidCapabilities", { detail: deviceCapabilities }));
		return;
	}
	if (packet.type === "open-task" && typeof packet.taskId === "string" && typeof packet.projectId === "string") {
		window.dispatchEvent(new CustomEvent("rpc:openTaskFromNotification", {
			detail: { taskId: packet.taskId, projectId: packet.projectId },
		}));
		return;
	}
	if (packet.type === "logout-request") {
		try {
			await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
		} finally {
			send(installedPort, { type: "logout-result" });
		}
		return;
	}

	const command = parseCommand(event.data);
	if (!command) return;
	const binding = activeBinding;
	if (!binding || binding.context.rawMode || androidTerminalContextKey(binding.context) !== command.contextKey) {
		send(installedPort, {
			type: "command-result",
			requestId: command.requestId,
			ok: false,
			deliveryStatus: "not-delivered",
			error: !binding
				? "No active terminal"
				: binding.context.rawMode
					? "Terminal is in raw mode"
					: "Terminal context changed",
		});
		return;
	}

	try {
		if (command.type === "submit") {
			const deliveryStatus = await binding.submit(command.text);
			send(installedPort, {
				type: "command-result",
				requestId: command.requestId,
				ok: deliveryStatus === "delivered",
				deliveryStatus,
				error: deliveryStatus === "delivered" ? undefined : `Prompt delivery ${deliveryStatus}`,
			});
		} else {
			binding.handle.paste(command.text);
			send(installedPort, {
				type: "command-result",
				requestId: command.requestId,
				ok: true,
				deliveryStatus: "unconfirmed",
			});
		}
	} catch (error) {
		send(installedPort, {
			type: "command-result",
			requestId: command.requestId,
			ok: false,
			deliveryStatus: "unconfirmed",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function isAndroidAppShell(): boolean {
	return typeof window !== "undefined" && window.__DEV3_ANDROID_APP__ === true;
}

export function isAndroidAppHost(): boolean {
	return isAndroidAppShell() && !!window.dev3Android;
}

export function installAndroidClientBridge(port: AndroidWebMessagePort | undefined = window.dev3Android): () => void {
	if (!port || installedPort === port) return () => {};
	installedPort = port;
	port.addEventListener("message", handleCommand);
	if (!authFailureBound) {
		window.addEventListener("rpc:authFailed", forwardAuthFailure);
		window.addEventListener(RPC_STATUS_EVENT, forwardRpcState);
		window.addEventListener("dev3:backOutcome", forwardBackOutcome);
		authFailureBound = true;
	}
	installAndroidDevicePolyfills();
	send(port, { type: "bridge-ready", version: 1 });
	return () => {
		port.removeEventListener("message", handleCommand);
		if (authFailureBound) {
			window.removeEventListener("rpc:authFailed", forwardAuthFailure);
			window.removeEventListener(RPC_STATUS_EVENT, forwardRpcState);
			window.removeEventListener("dev3:backOutcome", forwardBackOutcome);
			authFailureBound = false;
		}
		if (installedPort === port) installedPort = null;
	};
}

export function getAndroidDeviceCapabilities(): AndroidDeviceCapabilities | null {
	return deviceCapabilities;
}

export function requestAndroidDevice<T = unknown>(action: string, payload?: Record<string, unknown>): Promise<T> {
	if (!isAndroidAppHost()) return Promise.reject(new Error("Android host is unavailable"));
	installAndroidClientBridge();
	const requestId = `device-${deviceRequestEpoch}-${++deviceRequestSequence}`;
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			pendingDeviceRequests.delete(requestId);
			reject(new Error(`Android device request timed out: ${action}`));
		}, 30_000);
		pendingDeviceRequests.set(requestId, { resolve: resolve as (payload: unknown) => void, reject, timeout });
		send(installedPort, { type: "device-request", requestId, action, payload: payload ?? {} });
	});
}

export function writeAndroidClipboardText(text: string): Promise<void> {
	return requestAndroidDevice<void>("clipboard-write-text", { text });
}

export function saveAndroidBase64File(base64: string, mime: string, fileName: string): Promise<void> {
	return requestAndroidDevice<void>("save-file", { base64, mime, fileName });
}

export function saveAndroidRemoteFile(url: string, mime: string, fileName: string, bytes: number): Promise<void> {
	return requestAndroidDevice<void>("save-remote-file", { url, mime, fileName, bytes });
}

export function openAndroidExternal(url: string): Promise<void> {
	return requestAndroidDevice<void>("open-external", { url });
}

export function openAndroidHtml(fileName: string, html: string): Promise<void> {
	return requestAndroidDevice<void>("open-html", { fileName, html });
}

export function showAndroidNotification(payload: object): Promise<void> {
	return requestAndroidDevice<void>("show-notification", { ...payload });
}

export function requestAndroidNotificationPermission(): Promise<AndroidDeviceCapabilities> {
	return requestAndroidDevice<AndroidDeviceCapabilities>("request-notification-permission");
}

function installAndroidDevicePolyfills(): void {
	if (!isAndroidAppHost()) return;
	if (!clipboardPatched) {
		originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		clipboardPatched = true;
		const clipboard = navigator.clipboard ?? {} as Clipboard;
		try {
			Object.defineProperty(clipboard, "writeText", {
				configurable: true,
				value: (text: string) => writeAndroidClipboardText(String(text)),
			});
			if (!navigator.clipboard) Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
		} catch {
			/* Clipboard helpers retain their existing fallback. */
		}
	}
	if (deviceCapabilities?.externalOpen === false && originalWindowOpen) {
		window.open = originalWindowOpen;
		originalWindowOpen = null;
	}
	if (deviceCapabilities?.externalOpen === true && originalWindowOpen === null) {
		originalWindowOpen = window.open.bind(window);
		window.open = ((url?: string | URL, target?: string, features?: string) => {
			if (url !== undefined) {
				try {
					const absolute = new URL(String(url), window.location.href);
					if (absolute.protocol !== "blob:" && absolute.protocol !== "data:") {
						void openAndroidExternal(absolute.href).catch(() => {});
						return window;
					}
				} catch { /* keep the browser fallback */ }
			}
			return originalWindowOpen?.(url, target, features) ?? null;
		}) as typeof window.open;
	}
}

export function appendAndroidDraft(context: AndroidTerminalContext, text: string): void {
	if (!isAndroidAppHost() || !text) return;
	installAndroidClientBridge();
	send(installedPort, { type: "append-draft", contextKey: androidTerminalContextKey(context), text });
}

export function bindAndroidTerminal(
	context: AndroidTerminalContext,
	handle: TerminalHandle,
	submit: (text: string) => Promise<AgentPromptDeliveryStatus>,
): () => void {
	if (!isAndroidAppHost()) return () => {};
	installAndroidClientBridge();
	const binding: AndroidTerminalBinding = { context, handle, submit };
	activeBinding = binding;
	send(installedPort, { type: "terminal-context", context });
	return () => {
		if (activeBinding !== binding) return;
		activeBinding = null;
		send(installedPort, { type: "terminal-context", context: null });
	};
}

export function __resetAndroidClientBridgeForTests(): void {
	if (installedPort) installedPort.removeEventListener("message", handleCommand);
	if (authFailureBound) {
		window.removeEventListener("rpc:authFailed", forwardAuthFailure);
		window.removeEventListener(RPC_STATUS_EVENT, forwardRpcState);
		window.removeEventListener("dev3:backOutcome", forwardBackOutcome);
	}
	activeBinding = null;
	installedPort = null;
	authFailureBound = false;
	deviceCapabilities = null;
	for (const pending of pendingDeviceRequests.values()) {
		clearTimeout(pending.timeout);
		pending.reject(new Error("Android bridge reset"));
	}
	pendingDeviceRequests.clear();
	if (clipboardPatched) {
		try {
			if (originalClipboardDescriptor) Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
			else Reflect.deleteProperty(navigator, "clipboard");
		} catch { /* test cleanup only */ }
		originalClipboardDescriptor = undefined;
		clipboardPatched = false;
	}
	if (originalWindowOpen) {
		window.open = originalWindowOpen;
		originalWindowOpen = null;
	}
}

if (isAndroidAppHost()) installAndroidClientBridge();
