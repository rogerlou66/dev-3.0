import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalog } from "../../shared/model-catalog";

const h = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	getDescendantPids: vi.fn<(pid: number) => Promise<number[]>>(),
	fs: {
		existsSync: vi.fn((p: string) => p === "/opt/dev3/bifrost-http"),
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		chmodSync: vi.fn(),
		realpathSync: vi.fn(() => "/apps/dev3.app/Contents/MacOS/bun"),
	},
	catalog: vi.fn<() => ModelCatalog>(),
	keys: vi.fn<() => Record<string, string>>(),
}));

vi.mock("../spawn", () => ({ spawn: h.spawnMock }));
vi.mock("../port-scanner", () => ({ getDescendantPids: h.getDescendantPids }));
vi.mock("node:fs", () => h.fs);
vi.mock("../paths", () => ({ DEV3_HOME: "/tmp/dev3-model-catalog-test" }));
vi.mock("../model-catalog-store", () => ({
	loadModelCatalog: h.catalog,
	loadProviderKeys: h.keys,
}));

const CATALOG: ModelCatalog = {
	providers: [
		{ id: "p-or", kind: "openrouter", label: "OpenRouter" },
		{ id: "p-custom", kind: "custom", label: "My Box", baseUrl: "https://llm.example.com/v1" },
		{ id: "p-oai", kind: "openai", label: "OpenAI" },
	],
	models: [
		{ id: "m-fast", providerId: "p-or", name: "fast", modelId: "deepseek/flash" },
		{ id: "m-local", providerId: "p-custom", name: "local", modelId: "qwen3" },
	],
};

/** A spawned process that stays alive and prints `banner`. */
function liveProcess(pid = 5150, banner = "bifrost up") {
	return {
		pid,
		exited: new Promise<number>(() => {}),
		stdout: streamOf(banner),
		stderr: streamOf(""),
		kill: vi.fn(),
	};
}

/** A spawned process that dies immediately with the given output. */
function deadProcess(output: string) {
	return {
		pid: 5151,
		exited: Promise.resolve(1),
		stdout: streamOf(output),
		stderr: streamOf(""),
		kill: vi.fn(),
	};
}

function streamOf(text: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			if (text) controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

/** Answer /health and /v1/models. `healthy` decides per call, so a test can
 *  make the port refuse connections until the attempt that should succeed. */
function stubHttp(models: string[] = [], healthy: () => boolean = () => true) {
	vi.stubGlobal("fetch", vi.fn(async (url: string) => {
		if (String(url).endsWith("/health")) {
			if (!healthy()) throw new Error("connection refused");
			return { ok: true, status: 200 } as Response;
		}
		return {
			ok: true,
			status: 200,
			json: async () => ({ data: models.map((id) => ({ id })) }),
		} as unknown as Response;
	}));
}

async function freshModule() {
	vi.resetModules();
	return import("../model-sidecar");
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	process.env.DEV3_BIFROST_BINARY = "/opt/dev3/bifrost-http";
	h.getDescendantPids.mockResolvedValue([]);
	h.catalog.mockReturnValue(CATALOG);
	h.keys.mockReturnValue({ "p-or": "sk-or-live", "p-custom": "sk-custom" });
	h.fs.existsSync.mockImplementation((p: string) => p === "/opt/dev3/bifrost-http");
	h.spawnMock.mockImplementation(() => liveProcess());
	stubHttp();
});

describe("binary resolution", () => {
	it("prefers an explicit development override", async () => {
		const { resolveSidecarBinary } = await freshModule();
		expect(resolveSidecarBinary()).toBe("/opt/dev3/bifrost-http");
	});

	it("reports the binary as missing when the override does not exist", async () => {
		process.env.DEV3_BIFROST_BINARY = "/nope/bifrost-http";
		const { resolveSidecarBinary } = await freshModule();
		expect(resolveSidecarBinary()).toBeUndefined();
	});

	it("looks for the bundled copy inside the app, not on PATH", async () => {
		const { bundledSidecarCandidates } = await freshModule();
		expect(bundledSidecarCandidates("/apps/dev3.app/Contents/MacOS")).toContain(
			"/apps/dev3.app/Contents/Resources/app/bifrost/bifrost-http",
		);
	});

	it("has no candidates when the executable's directory is unknown", async () => {
		const { bundledSidecarCandidates } = await freshModule();
		expect(bundledSidecarCandidates(undefined)).toEqual([]);
	});
});

describe("credentials", () => {
	it("hands each provider's key to the child process under its own variable", async () => {
		const { buildSidecarEnv } = await freshModule();
		const env = buildSidecarEnv(CATALOG, { "p-or": "sk-or-live" }, { sessionKey: "sk-bf-1", encryptionKey: "abc" });
		expect(env.DEV3_LLM_KEY_OPENROUTER).toBe("sk-or-live");
		expect(env.DEV3_BIFROST_VIRTUAL_KEY).toBe("sk-bf-1");
	});

	it("skips a provider the user has not given a key yet", async () => {
		const { buildSidecarEnv } = await freshModule();
		const env = buildSidecarEnv(CATALOG, { "p-or": "sk-or-live" }, { sessionKey: "k", encryptionKey: "e" });
		expect(env.DEV3_LLM_KEY_OPENAI).toBeUndefined();
	});

	it("passes a custom endpoint's base URL through the environment too", async () => {
		const { buildSidecarEnv } = await freshModule();
		const env = buildSidecarEnv(CATALOG, { "p-custom": "sk" }, { sessionKey: "k", encryptionKey: "e" });
		expect(env.DEV3_LLM_BASE_URL_CUSTOM_MY_BOX).toBe("https://llm.example.com/v1");
	});
});

describe("starting", () => {
	it("comes up on a loopback port and reports it", async () => {
		const { ensureModelSidecar, getModelSidecarStatus } = await freshModule();
		const runtime = await ensureModelSidecar();
		expect(runtime.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(runtime.sessionKey).toMatch(/^sk-bf-/);
		expect(getModelSidecarStatus().running).toBe(true);
	});

	it("writes the generated config before launching, with the key only as a reference", async () => {
		const { ensureModelSidecar } = await freshModule();
		await ensureModelSidecar();
		const [, written] = h.fs.writeFileSync.mock.calls[0];
		expect(String(written)).toContain("env.DEV3_LLM_KEY_OPENROUTER");
		expect(String(written)).not.toContain("sk-or-live");
	});

	it("never puts a credential on the command line", async () => {
		const { ensureModelSidecar } = await freshModule();
		await ensureModelSidecar();
		expect(h.spawnMock.mock.calls[0][0].join(" ")).not.toContain("sk-");
	});

	it("serves concurrent launches from one process instead of racing two", async () => {
		const { ensureModelSidecar } = await freshModule();
		const [a, b] = await Promise.all([ensureModelSidecar(), ensureModelSidecar()]);
		expect(a.baseUrl).toBe(b.baseUrl);
		expect(h.spawnMock).toHaveBeenCalledTimes(1);
	});

	it("tries another port when the first attempt dies on a taken one", async () => {
		h.spawnMock
			.mockImplementationOnce(() => deadProcess("listen tcp 127.0.0.1:41234: address already in use"))
			.mockImplementationOnce(() => liveProcess());
		// The taken port refuses connections; the second attempt's port answers.
		stubHttp([], () => h.spawnMock.mock.calls.length > 1);
		const { ensureModelSidecar } = await freshModule();
		await expect(ensureModelSidecar()).resolves.toBeTruthy();
		expect(h.spawnMock).toHaveBeenCalledTimes(2);
	});

	it("fails with the process's own last words, not a bare error code", async () => {
		h.spawnMock.mockImplementation(() => deadProcess("config error: provider openrouter has no key"));
		stubHttp([], () => false);
		const { ensureModelSidecar, getModelSidecarStatus } = await freshModule();
		await expect(ensureModelSidecar()).rejects.toThrow(/provider openrouter has no key/);
		expect(getModelSidecarStatus().lastError).toContain("provider openrouter has no key");
	});

	it("says plainly when this build ships no proxy binary", async () => {
		process.env.DEV3_BIFROST_BINARY = "/nope/bifrost-http";
		const { ensureModelSidecar, getModelSidecarStatus } = await freshModule();
		await expect(ensureModelSidecar()).rejects.toThrow(/missing from this build/);
		expect(getModelSidecarStatus().binaryAvailable).toBe(false);
	});
});

describe("stopping", () => {
	it("terminates the process tree, not only the parent", async () => {
		h.getDescendantPids.mockResolvedValue([6001]);
		const killed: number[] = [];
		const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
			killed.push(pid);
			return true;
		}) as typeof process.kill);

		const { ensureModelSidecar, stopModelSidecar, getModelSidecarStatus } = await freshModule();
		await ensureModelSidecar();
		await stopModelSidecar();

		expect(killed).toEqual([6001, 5150]);
		expect(getModelSidecarStatus().running).toBe(false);
		killSpy.mockRestore();
	});

	it("is safe to call when nothing is running", async () => {
		const { stopModelSidecar } = await freshModule();
		await expect(stopModelSidecar()).resolves.toBeUndefined();
	});
});

describe("preflight", () => {
	const bindings = { opus: "m-fast", sonnet: "m-local" };

	it("passes when every bound model is served", async () => {
		stubHttp(["openrouter/fast", "custom-my-box/local"]);
		const { preflightModelRoles } = await freshModule();
		expect(await preflightModelRoles("claude", bindings, CATALOG)).toEqual({ ok: true, problems: [] });
	});

	it("passes untouched when the preset binds no roles", async () => {
		const { preflightModelRoles } = await freshModule();
		expect(await preflightModelRoles("claude", {}, CATALOG)).toEqual({ ok: true, problems: [] });
	});

	it("names the role whose catalog model was deleted", async () => {
		const { preflightModelRoles } = await freshModule();
		const result = await preflightModelRoles("claude", { opus: "m-gone" }, CATALOG);
		expect(result).toEqual({ ok: false, problems: [{ roleId: "opus", code: "missing-model" }] });
	});

	it("names the role whose model the proxy will not serve", async () => {
		stubHttp(["openrouter/fast"]);
		const { preflightModelRoles } = await freshModule();
		const result = await preflightModelRoles("claude", bindings, CATALOG);
		expect(result.ok).toBe(false);
		expect(result.problems).toEqual([
			expect.objectContaining({ roleId: "sonnet", code: "model-unreachable", detail: "custom-my-box/local" }),
		]);
	});

	it("reports the proxy itself when it cannot be reached", async () => {
		h.spawnMock.mockImplementation(() => deadProcess("boom"));
		stubHttp([], () => false);
		const { preflightModelRoles } = await freshModule();
		const result = await preflightModelRoles("claude", bindings, CATALOG);
		expect(result.problems[0].code).toBe("proxy-unreachable");
	});

	it("does not fail a launch just because the proxy lists nothing", async () => {
		stubHttp([]);
		const { preflightModelRoles } = await freshModule();
		expect((await preflightModelRoles("claude", bindings, CATALOG)).ok).toBe(true);
	});
});
