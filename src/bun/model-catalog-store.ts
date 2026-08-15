/**
 * On-disk home of the model catalog: `model-catalog.json` (providers + named
 * models) and `model-catalog-keys.json` (upstream keys, 0600). Both are additive
 * files under ~/.dev3.0, so the on-disk layout invariants (AGENTS.md) hold.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { EMPTY_MODEL_CATALOG, type CatalogProvider, type ModelCatalog } from "../shared/model-catalog";
import { createLogger } from "./logger";
import { DEV3_HOME } from "./paths";

const log = createLogger("model-catalog-store");

const CATALOG_FILE = `${DEV3_HOME}/model-catalog.json`;
const KEYS_FILE = `${DEV3_HOME}/model-catalog-keys.json`;

/** Keys are secrets: owner-only, like the Claude API profile file next to them. */
const SECRET_MODE = 0o600;

function readJson<T>(path: string, fallback: T): T {
	try {
		if (!existsSync(path)) return fallback;
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch (err) {
		log.warn("Unreadable model catalog file", { path, error: String(err) });
		return fallback;
	}
}

function writeJson(path: string, value: unknown, mode?: number): void {
	mkdirSync(DEV3_HOME, { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
}

export function loadModelCatalog(): ModelCatalog {
	const raw = readJson<Partial<ModelCatalog>>(CATALOG_FILE, EMPTY_MODEL_CATALOG);
	return {
		providers: Array.isArray(raw.providers) ? raw.providers : [],
		models: Array.isArray(raw.models) ? raw.models : [],
	};
}

export function saveModelCatalog(catalog: ModelCatalog): void {
	writeJson(CATALOG_FILE, catalog);
}

/** Provider id → upstream API key. Never sent to the renderer. */
export function loadProviderKeys(): Record<string, string> {
	return readJson<Record<string, string>>(KEYS_FILE, {});
}

export function saveProviderKeys(keys: Record<string, string>): void {
	writeJson(KEYS_FILE, keys, SECRET_MODE);
}

/** Reserved slot in the keys file for the sidecar's at-rest encryption key. A
 *  provider id is a UUID, so it can never collide with this name. */
const ENCRYPTION_KEY_SLOT = "dev3:sidecar-encryption-key";

/** The sidecar's encryption key, generated once and kept: it encrypts what the
 *  config store persists, and a fresh key makes the next start die on decrypt. */
export function loadOrCreateEncryptionKey(): string {
	const keys = loadProviderKeys();
	const existing = keys[ENCRYPTION_KEY_SLOT];
	if (existing) return existing;
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const generated = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	saveProviderKeys({ ...keys, [ENCRYPTION_KEY_SLOT]: generated });
	return generated;
}

/** Store, replace, or (with an empty value) drop one provider's key. */
export function setProviderKey(providerId: string, key: string | null): void {
	const keys = loadProviderKeys();
	if (key && key.trim()) keys[providerId] = key.trim();
	else delete keys[providerId];
	saveProviderKeys(keys);
}

/** Drop the key of a provider the user removed, so a deleted provider leaves no
 *  credential behind. */
export function forgetProviderKeys(providers: CatalogProvider[]): void {
	const live = new Set([...providers.map((p) => p.id), ENCRYPTION_KEY_SLOT]);
	const keys = loadProviderKeys();
	let changed = false;
	for (const id of Object.keys(keys)) {
		if (!live.has(id)) {
			delete keys[id];
			changed = true;
		}
	}
	if (changed) saveProviderKeys(keys);
}
