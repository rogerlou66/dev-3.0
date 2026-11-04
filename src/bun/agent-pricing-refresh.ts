import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveModelRate, type ModelRate } from "../shared/agent-pricing";
import { DEV3_HOME } from "./paths";

const CACHE_FILE = join(DEV3_HOME, "agent-pricing-v1.json");
const MAX_FEED_BYTES = 16 * 1024 * 1024;
const CATALOG_REVISION = 1;
const PROVIDERS = ["openai", "anthropic", "google", "openrouter"] as const;
const RATE_FIELDS = ["input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h"] as const;
type Rates = Record<string, ModelRate>;
interface PricingCache { version: 1; catalogRevision?: number; fetchedAt: number; rates: Rates }

let cache: PricingCache | null = null;
let loaded = false;
let loading: Promise<void> | null = null;

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validPrice(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

function validRate(value: unknown): value is ModelRate {
	const rate = object(value);
	return rate !== null && RATE_FIELDS.every((key) => validPrice(rate[key]));
}

function validModelId(value: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._/:\[\]-]{0,199}$/.test(value);
}

function canonicalNativeId(id: string): string {
	const legacyClaude = /^claude-(\d+(?:\.\d+)?)-(opus|sonnet|haiku)(?:-(?:thinking|low|medium|high|xhigh|max))*$/.exec(id);
	if (legacyClaude) return `claude-${legacyClaude[2]}-${legacyClaude[1].replaceAll(".", "-")}`;
	const claude = /^(?:claude-)?(opus|sonnet|haiku)-(\d+(?:[.-]\d+)?)(?:-(?:thinking|low|medium|high|xhigh|max))*$/.exec(id);
	if (claude) return `claude-${claude[1]}-${claude[2].replaceAll(".", "-")}`;
	return id;
}

function bundledRate(id: string): ModelRate | null {
	if (!id.includes("/")) return resolveModelRate(canonicalNativeId(id));
	const prefix = /^(openai|anthropic|google|deepseek|z-ai|qwen|moonshotai)\//.exec(id);
	return prefix ? resolveModelRate(canonicalNativeId(id.slice(prefix[0].length))) : null;
}

function readCachedRates(value: unknown): PricingCache | null {
	const stored = object(value);
	const rawRates = object(stored?.rates);
	if (stored?.version !== 1 || typeof stored.fetchedAt !== "number" ||
		!Number.isFinite(stored.fetchedAt) || stored.fetchedAt < 0) return null;
	if (!rawRates || (stored.fetchedAt as number) > Date.now() + 5 * 60_000) return null;
	const rates: Rates = Object.create(null);
	for (const [key, rate] of Object.entries(rawRates)) {
		if (PROVIDERS.some((provider) => key.startsWith(`${provider}:`)) && validModelId(key) && validRate(rate)) rates[key] = rate;
	}
	return Object.keys(rates).length ? {
		version: 1, fetchedAt: stored.fetchedAt as number, rates,
		catalogRevision: stored.catalogRevision === CATALOG_REVISION ? CATALOG_REVISION : 0,
	} : null;
}

async function loadCache(): Promise<void> {
	try {
		const text = await readFile(CACHE_FILE, "utf8");
		if (text.length <= MAX_FEED_BYTES) cache = readCachedRates(JSON.parse(text));
	} catch { /* Missing or invalid cache falls back to bundled rates. */ }
	loaded = true;
}

function resolveFrom(rates: Rates): (modelId: string) => ModelRate | null {
	return (modelId) => {
		const id = modelId.trim().toLowerCase().replace(/\[\d+[km]\]$/, "");
		const routedId = id.startsWith("openrouter/") ? id.slice("openrouter/".length) : id;
		const nativePrefix = !id.startsWith("openrouter/") && /^(openai|anthropic|google)\//.exec(id);
		const nativeId = canonicalNativeId(nativePrefix ? id.slice(nativePrefix[0].length) : id);
		const rate = id.includes("/")
			? rates[`openrouter:${routedId}`] ?? (nativePrefix ? rates[`${nativePrefix[1]}:${nativeId}`] : undefined)
			: rates[`openai:${id}`] ?? rates[`anthropic:${id}`] ?? rates[`google:${id}`]
				?? rates[`openai:${nativeId}`] ?? rates[`anthropic:${nativeId}`] ?? rates[`google:${nativeId}`];
		return rate ?? bundledRate(routedId);
	};
}

async function ensureCacheLoaded(): Promise<void> {
	if (loaded) return;
	loading ??= loadCache().finally(() => { loading = null; });
	await loading;
}

/** Resolve saved or bundled prices without contacting an external feed. */
export async function getPricingResolver(): Promise<(modelId: string) => ModelRate | null> {
	await ensureCacheLoaded();
	const rates = cache?.rates ?? {};
	return resolveFrom(rates);
}

/**
 * The resolver the usage report would use right now, for `dev3 stats prices`, and
 * when the saved table was fetched (null: built-in rates only). Never fetches.
 */
export async function describePricing(): Promise<{ fetchedAt: number | null; resolve: (modelId: string) => ModelRate | null }> {
	await ensureCacheLoaded();
	return { fetchedAt: cache?.fetchedAt ?? null, resolve: resolveFrom(cache?.rates ?? {}) };
}
