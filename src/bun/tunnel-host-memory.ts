/**
 * Learned hostname stability for a custom (bring-your-own) tunnel provider.
 *
 * Some providers hand out a fresh hostname per process (cloudflared quick
 * tunnels, ngrok's free tier), others always return the same one for the same
 * invocation (`--name`-style suffixes, ngrok reserved domains). dev3 cannot know
 * which from the command line alone, so it OBSERVES: the URL a command produced
 * last time is remembered, and a command that produces the same URL again has a
 * stable hostname.
 *
 * That single bit is what lets a self-update stop a custom tunnel instead of
 * leaking it (see `prepareHandoff` in self-update.ts) — the successor respawns
 * onto the same URL, so the host-bound session cookie survives with no orphaned
 * process left behind.
 *
 * Learning rather than asking: a declared "my hostname is fixed" setting can be
 * wrong, and being wrong means publishing a URL that does not route. An
 * observation cannot be — the worst case is `stable: false`, which is exactly
 * the conservative behaviour dev3 had before.
 *
 * ADDITIVE on-disk path (`~/.dev3.0/remote/tunnel-hosts.json`): no older version
 * reads it, and losing it only costs one restart of re-learning.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createLogger } from "./logger";
import { REMOTE_DIR } from "./remote-state";

const log = createLogger("tunnel-host");

export const TUNNEL_HOSTS_FILE = `${REMOTE_DIR}/tunnel-hosts.json`;

/**
 * One command's observation. Only the currently configured command is kept — a
 * machine runs one provider at a time, and a changed command is a different
 * question whose answer has to be re-learned from scratch.
 */
interface TunnelHostRecord {
	command: string;
	url: string;
	/** The same command produced this same URL in two separate processes. */
	stable: boolean;
}

function readRecord(): TunnelHostRecord | null {
	try {
		const parsed = JSON.parse(readFileSync(TUNNEL_HOSTS_FILE, "utf-8")) as Partial<TunnelHostRecord>;
		if (typeof parsed.command !== "string" || !parsed.command) return null;
		if (typeof parsed.url !== "string" || !parsed.url) return null;
		return { command: parsed.command, url: parsed.url, stable: parsed.stable === true };
	} catch {
		// Missing, unreadable or corrupt — nothing learned yet.
		return null;
	}
}

function writeRecord(record: TunnelHostRecord): void {
	try {
		mkdirSync(REMOTE_DIR, { recursive: true });
		writeFileSync(TUNNEL_HOSTS_FILE, JSON.stringify(record, null, 2));
	} catch (err) {
		// Best-effort: an unwritable file degrades to "never proven stable".
		log.warn("Could not persist the tunnel hostname observation", { error: String(err) });
	}
}

/**
 * Record the URL `command` just produced, and report whether its hostname is now
 * proven stable. A URL that differs from the remembered one resets the proof:
 * the provider rotates hostnames, or the user pointed the command elsewhere.
 */
export function recordCustomTunnelUrl(command: string, url: string): boolean {
	const prior = readRecord();
	const stable = prior?.command === command && prior.url === url;
	if (!prior || prior.command !== command || prior.url !== url || prior.stable !== stable) {
		writeRecord({ command, url, stable });
	}
	return stable;
}

/** Has `command` been observed producing the same hostname across restarts? */
export function customTunnelHostIsStable(command: string): boolean {
	const record = readRecord();
	return record?.command === command && record.stable;
}
