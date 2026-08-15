import { describe, expect, it } from "vitest";
import {
	CODEX_PROVIDER_KEY,
	buildSidecarConfig,
	catalogModelWireName,
	isValidCatalogModelName,
	modelRolesForAgent,
	orphanedRoleBindings,
	providerKeyEnvName,
	resolveModelRoleLaunch,
	roleBindingWarnings,
	sidecarProviderKey,
	validateCatalog,
	type ModelCatalog,
} from "../../shared/model-catalog";

/** A catalog with one key per provider kind the UI can offer. */
function catalog(): ModelCatalog {
	return {
		providers: [
			{ id: "p-oai", kind: "openai", label: "OpenAI" },
			{ id: "p-or", kind: "openrouter", label: "OpenRouter" },
			{ id: "p-custom", kind: "custom", label: "My Box", baseUrl: "https://llm.example.com/v1" },
		],
		models: [
			{ id: "m-fast", providerId: "p-or", name: "fast-gremlin", modelId: "deepseek/deepseek-flash" },
			{ id: "m-main", providerId: "p-oai", name: "my-main", modelId: "gpt-5.6-sol" },
			{ id: "m-local", providerId: "p-custom", name: "local", modelId: "qwen3" },
		],
	};
}

const RUNTIME = { baseUrl: "http://127.0.0.1:41234", sessionKey: "sk-bf-secret" };

describe("provider keys", () => {
	it("names a known provider after its kind so the wire name is predictable", () => {
		expect(sidecarProviderKey({ id: "p-oai", kind: "openai", label: "Whatever" })).toBe("openai");
		expect(sidecarProviderKey({ id: "p-or", kind: "openrouter", label: "OR" })).toBe("openrouter");
	});

	it("derives a custom endpoint's key from its label, slugified and prefixed", () => {
		expect(sidecarProviderKey({ id: "p1", kind: "custom", label: "My Box 2" })).toBe("custom-my-box-2");
	});

	it("gives each provider its own credential env var", () => {
		expect(providerKeyEnvName("openrouter")).toBe("DEV3_LLM_KEY_OPENROUTER");
		expect(providerKeyEnvName("custom-my-box")).toBe("DEV3_LLM_KEY_CUSTOM_MY_BOX");
	});
});

describe("wire names", () => {
	it("addresses a catalog model as provider/name", () => {
		expect(catalogModelWireName(catalog(), "m-fast")).toBe("openrouter/fast-gremlin");
		expect(catalogModelWireName(catalog(), "m-local")).toBe("custom-my-box/local");
	});

	it("has no wire name for a model that is gone", () => {
		expect(catalogModelWireName(catalog(), "m-deleted")).toBeUndefined();
	});
});

describe("buildSidecarConfig", () => {
	it("declares one provider block per configured provider, with the key referenced symbolically", () => {
		const config = buildSidecarConfig(catalog());
		expect(Object.keys(config.providers).sort()).toEqual(["custom-my-box", "openai", "openrouter"]);
		expect(config.providers.openrouter.keys[0].value).toBe("env.DEV3_LLM_KEY_OPENROUTER");
	});

	it("never writes a credential value into the document", () => {
		const serialized = JSON.stringify(buildSidecarConfig(catalog()));
		expect(serialized).not.toContain("sk-");
		expect(serialized.match(/"value":\s*"(?!env\.)/)).toBeNull();
	});

	it("turns each catalog model into an alias on its provider's key", () => {
		const config = buildSidecarConfig(catalog());
		expect(config.providers.openrouter.keys[0].aliases).toEqual({ "fast-gremlin": "deepseek/deepseek-flash" });
		expect(config.providers.openai.keys[0].aliases).toEqual({ "my-main": "gpt-5.6-sol" });
	});

	it("omits a provider that has no models, so an empty entry cannot break startup", () => {
		const only = catalog();
		only.models = only.models.filter((m) => m.providerId === "p-oai");
		expect(Object.keys(buildSidecarConfig(only).providers)).toEqual(["openai"]);
	});

	it("produces no providers at all for an empty catalog", () => {
		expect(buildSidecarConfig({ providers: [], models: [] }).providers).toEqual({});
	});

	it("describes a custom endpoint as an OpenAI-compatible provider with its base URL from env", () => {
		const config = buildSidecarConfig(catalog());
		const custom = config.providers["custom-my-box"];
		expect(custom.custom_provider_config?.base_provider_type).toBe("openai");
		expect(custom.network_config?.base_url).toBe("env.DEV3_LLM_BASE_URL_CUSTOM_MY_BOX");
	});

	it("allows the Responses protocol on a custom endpoint, because Codex speaks nothing else", () => {
		const allowed = buildSidecarConfig(catalog()).providers["custom-my-box"].custom_provider_config?.allowed_requests;
		expect(allowed?.responses).toBe(true);
		expect(allowed?.responses_stream).toBe(true);
	});

	it("gates every provider behind one local session key", () => {
		const config = buildSidecarConfig(catalog());
		expect(config.client.enforce_auth_on_inference).toBe(true);
		expect(config.client.allow_direct_keys).toBe(false);
		const vk = config.governance.virtual_keys[0];
		expect(vk.value).toBe("env.DEV3_BIFROST_VIRTUAL_KEY");
		expect(vk.provider_configs.map((p) => p.provider).sort()).toEqual(["custom-my-box", "openai", "openrouter"]);
	});

	it("keeps the config store off so the file stays the only source of truth", () => {
		expect(buildSidecarConfig(catalog()).config_store.enabled).toBe(false);
	});

	it("records token counts but never request bodies", () => {
		const config = buildSidecarConfig(catalog());
		expect(config.logs_store.enabled).toBe(true);
		expect(config.client.enable_logging).toBe(true);
		expect(config.client.disable_content_logging).toBe(true);
	});
});

describe("modelRolesForAgent", () => {
	it("offers Claude Code its own alias slots", () => {
		expect(modelRolesForAgent("claude").map((r) => r.id)).toEqual(["fable", "opus", "sonnet", "haiku"]);
	});

	it("offers Codex the roles Codex actually has", () => {
		expect(modelRolesForAgent("codex").map((r) => r.id)).toEqual(["main", "subagent", "review"]);
	});

	it("resolves an absolute binary path to its agent", () => {
		expect(modelRolesForAgent("/opt/homebrew/bin/claude").map((r) => r.id)).toContain("opus");
	});

	it("has no roles for an agent dev3 cannot route", () => {
		expect(modelRolesForAgent("gemini")).toEqual([]);
	});
});

describe("resolveModelRoleLaunch — Claude Code", () => {
	const bindings = { opus: "m-main", sonnet: "m-fast" };

	it("points Claude at the sidecar's Anthropic surface with the session key", () => {
		const plan = resolveModelRoleLaunch("claude", bindings, catalog(), RUNTIME);
		expect(plan?.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:41234/anthropic");
		expect(plan?.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-bf-secret");
	});

	it("clears an inherited Anthropic API key so a stale credential cannot win", () => {
		const plan = resolveModelRoleLaunch("claude", bindings, catalog(), RUNTIME);
		expect(plan?.unsetEnv).toContain("ANTHROPIC_API_KEY");
	});

	it("binds each assigned slot to its catalog model's wire name", () => {
		const plan = resolveModelRoleLaunch("claude", bindings, catalog(), RUNTIME);
		expect(plan?.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("openai/my-main");
		expect(plan?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("openrouter/fast-gremlin");
	});

	it("leaves an unassigned slot alone instead of inventing a model for it", () => {
		const plan = resolveModelRoleLaunch("claude", bindings, catalog(), RUNTIME);
		expect(plan?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
	});

	it("ignores a binding whose catalog model was deleted", () => {
		const plan = resolveModelRoleLaunch("claude", { opus: "m-gone" }, catalog(), RUNTIME);
		expect(plan).toBeUndefined();
	});

	it("rewrites the launch model to the slot the preset already meant", () => {
		const plan = resolveModelRoleLaunch("claude", bindings, catalog(), RUNTIME, "claude-sonnet-5");
		expect(plan?.modelFlag).toBe("openrouter/fast-gremlin");
	});

	it("falls back to the most capable bound slot when the preset's model matches none", () => {
		const plan = resolveModelRoleLaunch("claude", { sonnet: "m-fast" }, catalog(), RUNTIME, "claude-opus-5");
		expect(plan?.modelFlag).toBe("openrouter/fast-gremlin");
	});

	it("never leaves the launch naming a model the proxy cannot serve", () => {
		const plan = resolveModelRoleLaunch("claude", bindings, catalog(), RUNTIME, "claude-haiku-4-5");
		expect(plan?.modelFlag).not.toContain("claude-");
	});

	it("passes no CLI arguments — Claude is configured entirely by environment", () => {
		expect(resolveModelRoleLaunch("claude", bindings, catalog(), RUNTIME)?.args).toEqual([]);
	});
});

describe("resolveModelRoleLaunch — Codex CLI", () => {
	const bindings = { main: "m-main", subagent: "m-fast", review: "m-local" };

	it("hands Codex the session key as its OpenAI key", () => {
		const plan = resolveModelRoleLaunch("codex", bindings, catalog(), RUNTIME);
		expect(plan?.env.OPENAI_API_KEY).toBe("sk-bf-secret");
	});

	it("declares the sidecar as a Responses-speaking provider over plain HTTP", () => {
		const args = resolveModelRoleLaunch("codex", bindings, catalog(), RUNTIME)?.args.join(" ") ?? "";
		expect(args).toContain(`model_providers.${CODEX_PROVIDER_KEY}.wire_api="responses"`);
		expect(args).toContain(`model_providers.${CODEX_PROVIDER_KEY}.supports_websockets=false`);
		expect(args).toContain(`model_providers.${CODEX_PROVIDER_KEY}.base_url="http://127.0.0.1:41234/openai/v1"`);
		expect(args).toContain(`model_provider="${CODEX_PROVIDER_KEY}"`);
	});

	it("assigns each Codex role its own catalog model", () => {
		const args = resolveModelRoleLaunch("codex", bindings, catalog(), RUNTIME)?.args.join(" ") ?? "";
		expect(args).toContain('model="openai/my-main"');
		expect(args).toContain('agents.default_subagent_model="openrouter/fast-gremlin"');
		expect(args).toContain('review_model="custom-my-box/local"');
	});

	it("rewrites the launch model to the main role, since the flag beats the config", () => {
		expect(resolveModelRoleLaunch("codex", bindings, catalog(), RUNTIME)?.modelFlag).toBe("openai/my-main");
	});

	it("omits roles left unassigned rather than emitting an empty override", () => {
		const args = resolveModelRoleLaunch("codex", { main: "m-main" }, catalog(), RUNTIME)?.args.join(" ") ?? "";
		expect(args).not.toContain("review_model");
		expect(args).not.toContain("default_subagent_model");
	});

	it("routes nothing when the preset has no main model, so Codex keeps its own default", () => {
		expect(resolveModelRoleLaunch("codex", { review: "m-fast" }, catalog(), RUNTIME)).toBeUndefined();
	});
});

describe("resolveModelRoleLaunch — no roles", () => {
	it("changes nothing for a preset without bindings", () => {
		expect(resolveModelRoleLaunch("claude", undefined, catalog(), RUNTIME)).toBeUndefined();
		expect(resolveModelRoleLaunch("claude", {}, catalog(), RUNTIME)).toBeUndefined();
	});

	it("changes nothing for an agent dev3 cannot route", () => {
		expect(resolveModelRoleLaunch("gemini", { opus: "m-main" }, catalog(), RUNTIME)).toBeUndefined();
	});
});

describe("validation", () => {
	it("accepts a catalog the user built correctly", () => {
		expect(validateCatalog(catalog())).toEqual([]);
	});

	it("reports two models sharing a name, because a role binding must be unambiguous", () => {
		const dup = catalog();
		dup.models.push({ id: "m-dup", providerId: "p-oai", name: "fast-gremlin", modelId: "gpt-5-mini" });
		expect(validateCatalog(dup)).toEqual([
			expect.objectContaining({ code: "duplicate-name", modelId: "m-dup" }),
		]);
	});

	it("reports a model whose provider was removed", () => {
		const orphan = catalog();
		orphan.providers = orphan.providers.filter((p) => p.id !== "p-or");
		expect(validateCatalog(orphan)).toEqual([
			expect.objectContaining({ code: "unknown-provider", modelId: "m-fast" }),
		]);
	});

	it("calls a half-typed row unfinished rather than malformed", () => {
		const fresh = catalog();
		fresh.models.push({ id: "m-new", providerId: "p-oai", name: "", modelId: "" });
		expect(validateCatalog(fresh)).toEqual([expect.objectContaining({ code: "incomplete", modelId: "m-new" })]);
	});

	it("reports a name that cannot travel on the wire", () => {
		const bad = catalog();
		bad.models[0].name = "fast/gremlin";
		expect(validateCatalog(bad)).toEqual([expect.objectContaining({ code: "invalid-name" })]);
	});

	it("reports a custom endpoint with no base URL", () => {
		const bad = catalog();
		bad.providers[2].baseUrl = "";
		expect(validateCatalog(bad)).toEqual([expect.objectContaining({ code: "missing-base-url" })]);
	});

	it("rejects wire-hostile names and accepts ordinary ones", () => {
		expect(isValidCatalogModelName("fast-gremlin")).toBe(true);
		expect(isValidCatalogModelName("my.main_2")).toBe(true);
		expect(isValidCatalogModelName("fast gremlin")).toBe(false);
		expect(isValidCatalogModelName("")).toBe(false);
	});

	it("names the roles that point at a model the user deleted", () => {
		expect(orphanedRoleBindings({ opus: "m-gone", sonnet: "m-fast" }, catalog())).toEqual(["opus"]);
	});
});

describe("warnings", () => {
	it("warns when an OpenRouter model serves a Claude Code role", () => {
		expect(roleBindingWarnings("claude", { sonnet: "m-fast" }, catalog())).toEqual([
			expect.objectContaining({ code: "openrouter-claude-tools", roleId: "sonnet" }),
		]);
	});

	it("stays quiet for the same model under Codex", () => {
		expect(roleBindingWarnings("codex", { main: "m-fast" }, catalog())).toEqual([]);
	});

	it("stays quiet for a direct provider under Claude Code", () => {
		expect(roleBindingWarnings("claude", { opus: "m-main" }, catalog())).toEqual([]);
	});
});
