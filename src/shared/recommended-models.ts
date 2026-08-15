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

import type { CatalogProviderKind } from "./model-catalog";

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

/** Recommendations the user has not put in their catalog yet — the ones the
 *  launcher shows locked. Matched on the provider-native id, because that is
 *  what identifies a model; the user is free to have named it anything. */
export function unconnectedRecommendations(
	catalog: { providers: { id: string; kind: CatalogProviderKind }[]; models: { providerId: string; modelId: string }[] },
): RecommendedModel[] {
	const connected = new Set(
		catalog.models
			.filter((model) => catalog.providers.some((p) => p.id === model.providerId))
			.map((model) => model.modelId),
	);
	return RECOMMENDED_MODELS.filter((model) => !connected.has(model.modelId));
}
