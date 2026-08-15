/**
 * Download the pinned proxy-sidecar binary for this machine's target into
 * `vendor/bifrost/`, verifying its SHA-256 against `vendor/bifrost/pinned.json`.
 *
 *   bun scripts/fetch-bifrost.ts            verify against the pin (release CI)
 *   bun scripts/fetch-bifrost.ts --record   record the hash for a new version
 *
 * Without `--record` an unpinned target is a hard failure: shipping a binary
 * nobody checked is exactly the supply-chain step this script exists to avoid.
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BIFROST_VERSION, bifrostPinKey, bifrostTarget } from "../src/shared/bifrost-release";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR_DIR = `${ROOT}/vendor/bifrost`;
const PIN_FILE = `${VENDOR_DIR}/pinned.json`;

interface PinFile {
	version: string;
	/** `<platform>-<arch>` → lowercase hex SHA-256. */
	sha256: Record<string, string>;
}

function readPins(): PinFile {
	if (!existsSync(PIN_FILE)) return { version: BIFROST_VERSION, sha256: {} };
	return JSON.parse(readFileSync(PIN_FILE, "utf-8")) as PinFile;
}

async function main(): Promise<void> {
	const record = process.argv.includes("--record");
	const target = bifrostTarget(process.platform, process.arch);
	if (!target) {
		console.error(`[fetch-bifrost] no published build for ${process.platform}/${process.arch}`);
		process.exit(1);
	}

	const res = await fetch(target.url);
	if (!res.ok) {
		console.error(`[fetch-bifrost] ${target.url} answered ${res.status}`);
		process.exit(1);
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	const digest = createHash("sha256").update(bytes).digest("hex");

	const pins = readPins();
	const key = bifrostPinKey(process.platform, process.arch);
	const pinned = pins.version === BIFROST_VERSION ? pins.sha256[key] : undefined;

	if (record) {
		const next: PinFile = {
			version: BIFROST_VERSION,
			sha256: { ...(pins.version === BIFROST_VERSION ? pins.sha256 : {}), [key]: digest },
		};
		mkdirSync(VENDOR_DIR, { recursive: true });
		writeFileSync(PIN_FILE, `${JSON.stringify(next, null, 2)}\n`);
		console.log(`[fetch-bifrost] recorded ${key} ${digest}`);
	} else if (!pinned) {
		console.error(`[fetch-bifrost] ${key} is not pinned for ${BIFROST_VERSION} — run with --record after reviewing the build`);
		process.exit(1);
	} else if (pinned !== digest) {
		console.error(`[fetch-bifrost] checksum mismatch for ${key}\n  pinned:   ${pinned}\n  download: ${digest}`);
		process.exit(1);
	}

	mkdirSync(VENDOR_DIR, { recursive: true });
	const binaryPath = `${VENDOR_DIR}/${target.binaryName}`;
	writeFileSync(binaryPath, bytes);
	if (process.platform !== "win32") chmodSync(binaryPath, 0o755);
	console.log(`[fetch-bifrost] ${BIFROST_VERSION} → ${binaryPath} (${bytes.length} bytes)`);
}

if (import.meta.main) await main();
