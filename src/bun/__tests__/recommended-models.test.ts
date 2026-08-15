import {
	CLAUDE_ROLE_BUILTIN_MODEL,
	RECOMMENDED_MODELS,
	recommendedClaudeRoleModelIds,
	recommendedCodexRoleModelIds,
	unconnectedRecommendations,
} from "../../shared/recommended-models";
import { resolveModelRate } from "../../shared/agent-pricing";
import { isValidCatalogModelName } from "../../shared/model-catalog";

describe("the curated list itself", () => {
	it("gives every recommendation a name the wire format accepts", () => {
		// The name travels inside `provider/name`; an invalid one is an
		// unroutable request that only shows up at launch.
		for (const model of RECOMMENDED_MODELS) {
			expect(isValidCatalogModelName(model.name)).toBe(true);
		}
	});

	it("prices every recommendation, so no locked row can render without a number", () => {
		for (const model of RECOMMENDED_MODELS) {
			expect(resolveModelRate(model.modelId), model.modelId).not.toBeNull();
		}
	});

	it("prices every built-in it is compared against", () => {
		for (const builtin of Object.values(CLAUDE_ROLE_BUILTIN_MODEL)) {
			expect(resolveModelRate(builtin), builtin).not.toBeNull();
		}
	});

	it("is actually cheaper than what it replaces — the whole premise", () => {
		for (const model of RECOMMENDED_MODELS) {
			const ours = resolveModelRate(model.modelId)!;
			const theirs = resolveModelRate(CLAUDE_ROLE_BUILTIN_MODEL[model.claudeRole])!;
			expect(ours.output, model.modelId).toBeLessThan(theirs.output);
		}
	});

	it("uses distinct names and distinct ids", () => {
		expect(new Set(RECOMMENDED_MODELS.map((m) => m.name)).size).toBe(RECOMMENDED_MODELS.length);
		expect(new Set(RECOMMENDED_MODELS.map((m) => m.modelId)).size).toBe(RECOMMENDED_MODELS.length);
	});
});

describe("seeded role bindings", () => {
	it("leaves no Claude slot unbound, since an unbound one reaches a proxy that cannot serve it", () => {
		const roles = recommendedClaudeRoleModelIds();
		expect(Object.keys(roles).sort()).toEqual(["fable", "haiku", "opus", "sonnet"]);
	});

	it("gives the fast slots the same cheap model", () => {
		const roles = recommendedClaudeRoleModelIds();
		expect(roles.haiku).toBe(roles.sonnet);
	});

	it("never puts the cheapest model in Codex review", () => {
		const roles = recommendedCodexRoleModelIds();
		expect(roles.review).toBe(roles.main);
		expect(roles.review).not.toBe(roles.subagent);
	});

	it("binds every Codex role", () => {
		expect(Object.keys(recommendedCodexRoleModelIds()).sort()).toEqual(["main", "review", "subagent"]);
	});
});

describe("unconnectedRecommendations", () => {
	const provider = { id: "p1", kind: "openrouter" as const };

	it("offers everything when the catalog is empty", () => {
		expect(unconnectedRecommendations({ providers: [], models: [] })).toHaveLength(RECOMMENDED_MODELS.length);
	});

	it("goes silent the moment the user has a provider of their own", () => {
		// They already know third-party models exist — that is the only thing
		// these rows are for. Keeping them up would be nagging.
		expect(unconnectedRecommendations({ providers: [provider], models: [] })).toEqual([]);
	});

	it("goes silent for a local provider too, not just the one dev3 recommends", () => {
		expect(
			unconnectedRecommendations({ providers: [{ id: "p2", kind: "custom" }], models: [] }),
		).toEqual([]);
	});

	it("still offers everything when a model lingers but its provider is gone", () => {
		const left = unconnectedRecommendations({
			providers: [],
			models: [{ providerId: "p-deleted", modelId: "deepseek/deepseek-v4-pro-0813" }],
		});
		expect(left).toHaveLength(RECOMMENDED_MODELS.length);
	});
});
