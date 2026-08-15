import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfiguration } from "../../shared/types";
import type { ModelCatalog } from "../../shared/model-catalog";

const h = vi.hoisted(() => ({
	catalog: vi.fn<() => ModelCatalog>(),
	ensure: vi.fn<() => Promise<{ baseUrl: string; sessionKey: string }>>(),
	preflight: vi.fn(),
}));

vi.mock("../model-catalog-store", () => ({ loadModelCatalog: h.catalog }));
vi.mock("../model-sidecar", () => ({ ensureModelSidecar: h.ensure, preflightModelRoles: h.preflight }));

import { applyModelRoleLaunch } from "../agents";

const CATALOG: ModelCatalog = {
	providers: [
		{ id: "p-oai", kind: "openai", label: "OpenAI" },
		{ id: "p-or", kind: "openrouter", label: "OpenRouter" },
	],
	models: [
		{ id: "m-main", providerId: "p-oai", name: "my-main", modelId: "gpt-5.6-sol" },
		{ id: "m-fast", providerId: "p-or", name: "fast", modelId: "deepseek/flash" },
	],
};

function preset(over: Partial<AgentConfiguration> = {}): AgentConfiguration {
	return { id: "c1", name: "Preset", model: "claude-opus-5", ...over };
}

beforeEach(() => {
	vi.clearAllMocks();
	h.catalog.mockReturnValue(CATALOG);
	h.ensure.mockResolvedValue({ baseUrl: "http://127.0.0.1:41234", sessionKey: "sk-bf-x" });
	h.preflight.mockResolvedValue({ ok: true, problems: [] });
});

describe("a preset without roles", () => {
	it("launches exactly as before, without touching the proxy", async () => {
		const env: Record<string, string> = {};
		const result = await applyModelRoleLaunch("claude", preset(), env, {});
		expect(env).toEqual({});
		expect(result.config?.model).toBe("claude-opus-5");
		expect(h.ensure).not.toHaveBeenCalled();
	});
});

describe("a Claude preset with roles", () => {
	const config = preset({ modelRoles: { opus: "m-main", sonnet: "m-fast" } });

	it("pins the launch model at a catalog model, never at a Claude id the proxy cannot serve", async () => {
		const result = await applyModelRoleLaunch("claude", preset({ modelRoles: { sonnet: "m-fast" } }), {}, {});
		expect(result.config?.model).toBe("openrouter/fast");
	});

	it("routes the session at the proxy with a per-run key", async () => {
		const env: Record<string, string> = {};
		await applyModelRoleLaunch("claude", config, env, {});
		expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:41234/anthropic");
		expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-bf-x");
		expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("openai/my-main");
	});

	it("lets the preset's own env vars win, as everywhere else", async () => {
		const env: Record<string, string> = {};
		const withOverride = preset({ ...config, envVars: { ANTHROPIC_BASE_URL: "http://elsewhere" } });
		env.ANTHROPIC_BASE_URL = "http://elsewhere";
		await applyModelRoleLaunch("claude", withOverride, env, {});
		expect(env.ANTHROPIC_BASE_URL).toBe("http://elsewhere");
	});

	it("refuses to launch when a role points at a deleted model", async () => {
		await expect(
			applyModelRoleLaunch("claude", preset({ modelRoles: { opus: "m-gone" } }), {}, {}),
		).rejects.toThrow(/no longer exist: opus/);
		expect(h.ensure).not.toHaveBeenCalled();
	});

	it("refuses to launch when the proxy cannot serve a role, naming it", async () => {
		h.preflight.mockResolvedValue({
			ok: false,
			problems: [{ roleId: "sonnet", code: "model-unreachable", detail: "openrouter/fast" }],
		});
		await expect(applyModelRoleLaunch("claude", config, {}, {})).rejects.toThrow(/sonnet: model-unreachable/);
	});

	it("refuses to launch when the proxy will not start", async () => {
		h.ensure.mockRejectedValue(new Error("The bundled model proxy is missing from this build."));
		await expect(applyModelRoleLaunch("claude", config, {}, {})).rejects.toThrow(/missing from this build/);
	});
});

describe("a Codex preset with roles", () => {
	const config = preset({ model: "gpt-5.6-sol", modelRoles: { main: "m-main", subagent: "m-fast" } });

	it("pins the launch model to the main role, since the flag beats the config", async () => {
		const result = await applyModelRoleLaunch("codex", config, {}, {});
		expect(result.config?.model).toBe("openai/my-main");
	});

	it("configures Codex only through launch flags, leaving ~/.codex alone", async () => {
		const result = await applyModelRoleLaunch("codex", config, {}, {});
		const args = result.options.modelRoleArgs?.join(" ") ?? "";
		expect(args).toContain('wire_api="responses"');
		expect(args).toContain('agents.default_subagent_model="openrouter/fast"');
	});

	it("refuses to launch when the main role is missing, instead of using Codex's own model", async () => {
		await expect(
			applyModelRoleLaunch("codex", preset({ modelRoles: { review: "m-fast" } }), {}, {}),
		).rejects.toThrow(/not the model the agent actually launches with/);
	});

	it("hands Codex the session key instead of any upstream key", async () => {
		const env: Record<string, string> = {};
		await applyModelRoleLaunch("codex", config, env, {});
		expect(env.OPENAI_API_KEY).toBe("sk-bf-x");
	});
});
