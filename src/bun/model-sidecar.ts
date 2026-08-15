/**
 * The proxy sidecar behind the model catalog: one Bifrost process per app, on a
 * loopback port dev3 picks, started on demand and dying with the app. Upstream
 * keys reach it only through its child environment. The binary is pinned and
 * bundled (bundled-tmux precedent, decisions/2026/07/16) — never downloaded.
 */

import { createServer } from "node:net";
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	ENCRYPTION_KEY_ENV,
	SESSION_KEY_ENV,
	buildSidecarConfig,
	catalogModelWireName,
	modelRolesForAgent,
	providerBaseUrlEnvName,
	providerKeyEnvName,
	sidecarProviderKey,
	type ModelCatalog,
	type ModelRoleBindings,
} from "../shared/model-catalog";
import { BIFROST_VERSION } from "../shared/bifrost-release";
import type { ModelSidecarStatus, ModelCatalogPreflight } from "../shared/types";
import { createLogger } from "./logger";
import { loadModelCatalog, loadOrCreateEncryptionKey, loadProviderKeys } from "./model-catalog-store";
import { DEV3_HOME } from "./paths";
import { getDescendantPids } from "./port-scanner";
import { spawn } from "./spawn";

const log = createLogger("model-sidecar");

/** Runtime dir: 0700, holds the generated config and nothing the user edits. */
const RUNTIME_DIR = `${DEV3_HOME}/model-catalog-runtime`;
const CONFIG_PATH = `${RUNTIME_DIR}/config.json`;

const BINARY_NAME = process.platform === "win32" ? "bifrost-http.exe" : "bifrost-http";

/** How long a start may take before dev3 gives up and shows the process output. */
const READY_TIMEOUT_MS = 20_000;
/** Port collisions are a race, not a state — a couple of retries settle it. */
const START_ATTEMPTS = 4;
/** Last lines of the process output kept for a diagnosable failure message. */
const OUTPUT_LINES = 40;

interface RunningSidecar {
	pid: number;
	port: number;
	baseUrl: string;
	sessionKey: string;
	kill: () => void;
	output: () => string;
}

let running: RunningSidecar | null = null;
let starting: Promise<RunningSidecar> | null = null;
let lastError: string | undefined;

/** Where the bundled binary may sit, mirroring the bundled-tmux layout: inside
 *  the app bundle's Resources, or beside the executable in a tarball. */
export function bundledSidecarCandidates(realExecDir: string | undefined, binaryName = BINARY_NAME): string[] {
	if (!realExecDir) return [];
	return [
		resolve(realExecDir, "..", "Resources", "app", "bifrost", binaryName),
		join(realExecDir, "bifrost", binaryName),
		// Windows / Linux packaging keeps resources beside the executable tree.
		resolve(realExecDir, "..", "Resources", "bifrost", binaryName),
	];
}

function realExecDir(): string | undefined {
	try {
		return dirname(realpathSync(process.execPath));
	} catch {
		return undefined;
	}
}

/** The binary to run: a development override, else the bundled copy. Never
 *  PATH — a stray unpinned build would change behaviour between machines. */
export function resolveSidecarBinary(): string | undefined {
	const override = process.env.DEV3_BIFROST_BINARY?.trim();
	if (override) return existsSync(override) ? override : undefined;
	return bundledSidecarCandidates(realExecDir()).find((p) => existsSync(p));
}

/** Ask the OS for a free loopback port, then release it. The gap before the
 *  sidecar binds is a real race — handled by retrying, not by pretending. */
export async function chooseCandidatePort(): Promise<number> {
	return await new Promise<number>((resolvePort, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen({ host: "127.0.0.1", port: 0 }, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Failed to resolve an ephemeral TCP port"));
				return;
			}
			const port = address.port;
			server.close((err) => (err ? reject(err) : resolvePort(port)));
		});
	});
}

function randomSecret(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Env the sidecar's child process gets: every credential, and nothing else new. */
export function buildSidecarEnv(
	catalog: ModelCatalog,
	keys: Record<string, string>,
	secrets: { sessionKey: string; encryptionKey: string },
): Record<string, string> {
	const env: Record<string, string> = {
		[SESSION_KEY_ENV]: secrets.sessionKey,
		[ENCRYPTION_KEY_ENV]: secrets.encryptionKey,
	};
	for (const provider of catalog.providers) {
		const key = keys[provider.id];
		if (!key) continue;
		const providerKey = sidecarProviderKey(provider);
		env[providerKeyEnvName(providerKey)] = key;
		if (provider.kind === "custom" && provider.baseUrl) {
			env[providerBaseUrlEnvName(providerKey)] = provider.baseUrl;
		}
	}
	return env;
}

function writeConfig(catalog: ModelCatalog): void {
	mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(buildSidecarConfig(catalog, RUNTIME_DIR), null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(RUNTIME_DIR, 0o700);
	} catch {
		/* best-effort on filesystems without POSIX modes */
	}
}

async function waitForHealth(baseUrl: string, alive: () => boolean, output: () => string): Promise<void> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (!alive()) throw new Error(`The model proxy exited before it was ready.\n${output()}`);
		try {
			const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
			if (res.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new Error(`The model proxy did not become ready in ${READY_TIMEOUT_MS / 1000}s.\n${output()}`);
}

/** Keep only the tail of the process output, so a failure message is useful and bounded. */
function makeOutputBuffer(): { push: (chunk: string) => void; text: () => string } {
	let lines: string[] = [];
	return {
		push: (chunk) => {
			lines.push(...chunk.split("\n"));
			if (lines.length > OUTPUT_LINES) lines = lines.slice(-OUTPUT_LINES);
		},
		text: () => lines.join("\n").trim(),
	};
}

async function launchOnce(binary: string, env: Record<string, string>, sessionKey: string): Promise<RunningSidecar> {
	const port = await chooseCandidatePort();
	const baseUrl = `http://127.0.0.1:${port}`;
	const buffer = makeOutputBuffer();

	const proc = spawn(
		[binary, "-host", "127.0.0.1", "-port", String(port), "-app-dir", RUNTIME_DIR, "-log-level", "warn", "-log-style", "json"],
		{ env, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
	);

	let exited = false;
	void proc.exited.then(() => {
		exited = true;
	});
	void pumpStream(proc.stdout, buffer.push);
	void pumpStream(proc.stderr, buffer.push);

	try {
		await waitForHealth(baseUrl, () => !exited, buffer.text);
	} catch (err) {
		try {
			proc.kill();
		} catch {
			/* already gone */
		}
		throw err;
	}

	return {
		pid: proc.pid ?? 0,
		port,
		baseUrl,
		sessionKey,
		kill: () => proc.kill(),
		output: buffer.text,
	};
}

async function pumpStream(stream: unknown, push: (chunk: string) => void): Promise<void> {
	const readable = stream as ReadableStream<Uint8Array> | undefined | null;
	if (!readable || typeof readable.getReader !== "function") return;
	const reader = readable.getReader();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) push(decoder.decode(value, { stream: true }));
		}
	} catch {
		/* the process died; the buffer already holds what it said */
	}
}

/** Start the sidecar if it is not up and return its runtime. Concurrent callers
 *  share one start, so two launches cannot race two processes onto two ports. */
export async function ensureModelSidecar(): Promise<{ baseUrl: string; sessionKey: string }> {
	if (running) return { baseUrl: running.baseUrl, sessionKey: running.sessionKey };
	if (!starting) starting = startSidecar().finally(() => (starting = null));
	const instance = await starting;
	return { baseUrl: instance.baseUrl, sessionKey: instance.sessionKey };
}

async function startSidecar(): Promise<RunningSidecar> {
	const binary = resolveSidecarBinary();
	if (!binary) {
		lastError = "The bundled model proxy is missing from this build.";
		throw new Error(lastError);
	}

	const catalog = loadModelCatalog();
	writeConfig(catalog);

	const sessionKey = `sk-bf-${randomSecret(24)}`;
	const env = buildSidecarEnv(catalog, loadProviderKeys(), {
		sessionKey,
		encryptionKey: loadOrCreateEncryptionKey(),
	});

	let failure: unknown;
	for (let attempt = 1; attempt <= START_ATTEMPTS; attempt += 1) {
		try {
			const instance = await launchOnce(binary, env, sessionKey);
			running = instance;
			lastError = undefined;
			log.info("Model proxy started", { pid: instance.pid, port: instance.port, attempt });
			return instance;
		} catch (err) {
			failure = err;
			log.warn("Model proxy start attempt failed", { attempt, error: String(err) });
		}
	}
	lastError = String(failure instanceof Error ? failure.message : failure);
	throw new Error(lastError);
}

/** Stop the sidecar and its children. Safe to call when nothing is running. */
export async function stopModelSidecar(): Promise<void> {
	const instance = running;
	running = null;
	if (!instance) return;
	const pids = instance.pid ? [instance.pid, ...(await getDescendantPids(instance.pid))] : [];
	// Children first, then the parent — an orphan holding the port outlives the app.
	for (const pid of pids.reverse()) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			/* already gone */
		}
	}
	try {
		instance.kill();
	} catch {
		/* already gone */
	}
	log.info("Model proxy stopped", { pid: instance.pid });
}

/** Apply catalog edits: the config is read once at startup, so a change needs a
 *  fresh process. Announced in the UI — running sessions lose their route. */
export async function restartModelSidecar(): Promise<ModelSidecarStatus> {
	await stopModelSidecar();
	try {
		await ensureModelSidecar();
	} catch (err) {
		log.warn("Model proxy restart failed", { error: String(err) });
	}
	return getModelSidecarStatus();
}

export function getModelSidecarStatus(): ModelSidecarStatus {
	const catalog = loadModelCatalog();
	return {
		running: running != null,
		starting: starting != null,
		port: running?.port,
		baseUrl: running?.baseUrl,
		binaryAvailable: resolveSidecarBinary() != null,
		version: BIFROST_VERSION,
		providerCount: catalog.providers.length,
		modelCount: catalog.models.length,
		lastError,
	};
}

/** Model ids the sidecar can actually serve right now, for the id combobox.
 *  Starts the sidecar on demand — the list is only real once it is up. */
export async function listSidecarModels(providerKey?: string): Promise<string[]> {
	const { baseUrl, sessionKey } = await ensureModelSidecar();
	const url = providerKey ? `${baseUrl}/v1/models?provider=${encodeURIComponent(providerKey)}` : `${baseUrl}/v1/models`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${sessionKey}` },
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) throw new Error(`The model proxy answered ${res.status} when listing models.`);
	const body = (await res.json()) as { data?: { id?: string }[] };
	return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}

/** Check a preset's roles before spawning, so a broken setup fails with the
 *  offending role named instead of as a dead terminal. */
export async function preflightModelRoles(
	baseCommand: string,
	bindings: ModelRoleBindings | undefined,
	catalog: ModelCatalog = loadModelCatalog(),
): Promise<ModelCatalogPreflight> {
	const roles = modelRolesForAgent(baseCommand);
	const bound = Object.entries(bindings ?? {}).filter(([role]) => roles.some((r) => r.id === role));
	if (bound.length === 0) return { ok: true, problems: [] };

	const problems: ModelCatalogPreflight["problems"] = [];
	for (const [roleId, modelId] of bound) {
		const wire = catalogModelWireName(catalog, modelId);
		if (!wire) problems.push({ roleId, code: "missing-model" });
	}
	if (problems.length > 0) return { ok: false, problems };

	let available: string[] = [];
	try {
		available = await listSidecarModels();
	} catch (err) {
		// The proxy answered its health check, so it is up; one provider refusing to
		// enumerate is not a reason to block a launch that may not even use it.
		log.warn("Model listing failed during preflight", { error: String(err) });
		if (!running) {
			return { ok: false, problems: [{ roleId: "", code: "proxy-unreachable", detail: String(err instanceof Error ? err.message : err) }] };
		}
	}

	// An empty listing means the sidecar could not enumerate anything; treating it
	// as "all models missing" would block every launch on a provider that simply
	// does not list. Only a non-empty listing is evidence.
	if (available.length > 0) {
		for (const [roleId, modelId] of bound) {
			const wire = catalogModelWireName(catalog, modelId);
			if (wire && !available.includes(wire)) problems.push({ roleId, code: "model-unreachable", detail: wire });
		}
	}
	return { ok: problems.length === 0, problems };
}
