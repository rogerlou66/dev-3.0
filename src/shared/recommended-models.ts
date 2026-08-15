/**
 * The open-source models dev3 offers before the user has connected anything.
 *
 * Two jobs, and they are the same data:
 *   - the launcher shows them in the Model list as locked rows with a price, so
 *     a user who never heard of this learns it exists at the moment they pick a
 *     model (that is the single biggest drop-off — nobody searches for a
 *     capability they do not know about);
 *   - connecting a provider seeds the catalog and the presets from the same
 *     list, so the user never types a model slug.
 *
 * Deliberately hardcoded rather than fetched: a first run must work offline, and
 * a stale list is a far smaller problem than an empty one. Prices are shown as
 * an order of magnitude, never as a bill — they move, and a release is how they
 * get corrected.
 */

import { modelRolesForAgent, type CatalogProviderKind } from "./model-catalog";
import type { AgentConfiguration, CodingAgent, ModelCatalogView } from "./types";

export interface RecommendedModel {
	/** Provider that serves it. Only providers dev3 can configure unattended. */
	providerKind: CatalogProviderKind;
	/** The provider-native id, exactly as it travels on the wire. */
	modelId: string;
	/** The catalog name dev3 gives it — also what the user sees in role pickers. */
	name: string;
	/** Human label for the Model list. */
	label: string;
	/** Which Claude Code slot it stands in for, and therefore which built-in
	 *  model it is priced against in the UI. */
	claudeRole: "fable" | "opus" | "sonnet" | "haiku";
	/** Which Codex slot it stands in for. Codex has three roles, Claude four, so
	 *  the two mappings are declared separately rather than derived. */
	codexRole?: "main" | "subagent" | "review";
	/** One short line on why this one. Shown under the model name. */
	blurbKey: string;
}

/**
 * The curated set. Order is the order they appear in the launcher.
 *
 * Chosen so that a user who connects and changes nothing gets a session that is
 * cheap AND competent: the model holding the plan is the one that matters, so
 * it gets a real model rather than the cheapest one available.
 */
export const RECOMMENDED_MODELS: RecommendedModel[] = [
	{
		providerKind: "openrouter",
		modelId: "qwen/qwen3.8-2.4t-a95b",
		name: "qwen3.8",
		label: "Qwen3.8 2.4T",
		claudeRole: "fable",
		blurbKey: "recommended.qwen38",
	},
	{
		providerKind: "openrouter",
		modelId: "deepseek/deepseek-v4-pro-0813",
		name: "ds-pro",
		label: "DeepSeek V4 Pro",
		claudeRole: "opus",
		codexRole: "main",
		blurbKey: "recommended.dsPro",
	},
	{
		providerKind: "openrouter",
		modelId: "deepseek/deepseek-v4-flash-0731",
		name: "ds-flash",
		label: "DeepSeek V4 Flash",
		claudeRole: "sonnet",
		codexRole: "subagent",
		blurbKey: "recommended.dsFlash",
	},
];

/** The built-in model each recommendation stands next to in the launcher, so
 *  the price comparison is against something the user already recognises. */
export const CLAUDE_ROLE_BUILTIN_MODEL: Record<RecommendedModel["claudeRole"], string> = {
	fable: "claude-fable-5",
	opus: "claude-opus-5",
	sonnet: "claude-sonnet-5",
	haiku: "claude-haiku-4-5",
};

/** Role bindings a freshly seeded Claude Code preset gets, keyed by role id.
 *  Haiku follows Sonnet: both are the "fast, does not have to be clever" slots,
 *  and leaving one unbound would send it to a model the proxy cannot serve. */
export function recommendedClaudeRoleModelIds(): Record<string, string> {
	const byRole: Record<string, string> = {};
	for (const model of RECOMMENDED_MODELS) byRole[model.claudeRole] = model.name;
	if (byRole.sonnet && !byRole.haiku) byRole.haiku = byRole.sonnet;
	return byRole;
}

/** Same for Codex. `review` follows `main`: review is the slot where being
 *  wrong is most expensive, so it never falls to the cheapest model. */
export function recommendedCodexRoleModelIds(): Record<string, string> {
	const byRole: Record<string, string> = {};
	for (const model of RECOMMENDED_MODELS) {
		if (model.codexRole) byRole[model.codexRole] = model.name;
	}
	if (byRole.main && !byRole.review) byRole.review = byRole.main;
	return byRole;
}

/**
 * The recommendations the launcher shows as locked rows.
 *
 * Empty as soon as the user has ANY provider of their own — OpenRouter, Ollama,
 * Fireworks, a custom endpoint, anything. The rows exist to teach someone that
 * a third-party model is possible at all; a user who already configured a
 * provider knows, and advertising to them is nagging. The catalog's own
 * "add a provider" action stays available regardless — that is a separate
 * control and never depends on this list.
 *
 * Otherwise: everything they have not connected, matched on the provider-native
 * id, because that identifies a model. The user is free to have named it
 * anything.
 */
export function unconnectedRecommendations(
	catalog: { providers: { id: string; kind: CatalogProviderKind }[]; models: { providerId: string; modelId: string }[] },
): RecommendedModel[] {
	if (catalog.providers.length > 0) return [];
	const connected = new Set(
		catalog.models
			.filter((model) => catalog.providers.some((p) => p.id === model.providerId))
			.map((model) => model.modelId),
	);
	return RECOMMENDED_MODELS.filter((model) => !connected.has(model.modelId));
}

// ------------------------------------------------------------------ seed ---

/** Group label the seeded presets carry, and the marker that says an agent has
 *  already been seeded. One constant so the picker, the seeder and the
 *  idempotency check cannot drift apart. */
export const SEEDED_GROUP_LABEL = "Open Source";

/**
 * Add the recommendations to the catalog under an existing provider.
 *
 * Matched on the provider-native id, so re-running it after the user renamed a
 * model adds nothing: connecting twice must not leave two rows that serve the
 * same thing and differ only by name.
 */
export function seedCatalogModels(
	catalog: ModelCatalogView,
	providerId: string,
	newId: () => string,
): ModelCatalogView {
	const existing = new Set(catalog.models.filter((m) => m.providerId === providerId).map((m) => m.modelId));
	const taken = new Set(catalog.models.map((m) => m.name));
	const added = RECOMMENDED_MODELS.filter((model) => !existing.has(model.modelId)).map((model) => ({
		id: newId(),
		providerId,
		// A name collision would be rejected on save, so a name already in use by
		// some other provider's model gets the provider id appended rather than
		// failing a flow the user only clicked one button for.
		name: taken.has(model.name) ? `${model.name}-${providerId.slice(0, 4)}` : model.name,
		modelId: model.modelId,
	}));
	return { providers: catalog.providers, models: [...catalog.models, ...added] };
}

/** Role id → catalog model **id** for one agent, resolved through the catalog.
 *  Roles bind by id, so this is where the curated names stop travelling. */
function bindingsForAgent(agent: CodingAgent, catalog: ModelCatalogView): Record<string, string> | null {
	const roles = modelRolesForAgent(agent.baseCommand);
	if (roles.length === 0) return null;
	const byName = new Map(catalog.models.map((m) => [m.name, m.id]));
	// Claude's role ids and Codex's are disjoint, so one merged map answers for
	// both and nothing here has to know which CLI it is looking at.
	const wanted = { ...recommendedClaudeRoleModelIds(), ...recommendedCodexRoleModelIds() };
	const bindings: Record<string, string> = {};
	for (const role of roles) {
		const catalogId = byName.get(wanted[role.id] ?? "");
		if (catalogId) bindings[role.id] = catalogId;
	}
	// A partial binding sends the unbound roles to a proxy that cannot serve
	// them, which fails mid-session rather than at launch. All or nothing.
	return Object.keys(bindings).length === roles.length ? bindings : null;
}

/**
 * The ready-to-run preset a freshly connected provider gives an agent.
 *
 * Cloned from the agent's own default preset rather than written from scratch:
 * whatever args and permissions that CLI needs are already right there, and a
 * hand-built preset is how a launch ends up missing one of them. Only the model
 * is replaced — that is the entire point.
 *
 * Null when the agent cannot be routed, is already seeded, or the catalog does
 * not carry every model its roles need.
 */
export function seedPresetForAgent(
	agent: CodingAgent,
	catalog: ModelCatalogView,
	newId: () => string,
): AgentConfiguration | null {
	if (agent.configurations.some((c) => c.groupLabel === SEEDED_GROUP_LABEL)) return null;
	const modelRoles = bindingsForAgent(agent, catalog);
	if (!modelRoles) return null;
	const base = agent.configurations.find((c) => c.id === agent.defaultConfigId) ?? agent.configurations[0];
	if (!base) return null;
	const { model: _model, requiresPxpipeProxy: _gated, ...rest } = base;
	return { ...rest, id: newId(), name: `${SEEDED_GROUP_LABEL} (${base.name})`, groupLabel: SEEDED_GROUP_LABEL, modelRoles };
}

/** Every agent with its seeded preset appended, agents that cannot be routed
 *  returned untouched. The caller saves the whole list back. */
export function seedAgentPresets(agents: CodingAgent[], catalog: ModelCatalogView, newId: () => string): CodingAgent[] {
	return agents.map((agent) => {
		const preset = seedPresetForAgent(agent, catalog, newId);
		return preset ? { ...agent, configurations: [...agent.configurations, preset] } : agent;
	});
}
