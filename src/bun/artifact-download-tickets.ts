import type { SharedArtifactDownloadFile } from "./shared-artifacts";

export const ARTIFACT_DOWNLOAD_ROUTE = "/api/artifact-download";
export const ARTIFACT_DOWNLOAD_TTL_MS = 10 * 60 * 1000;

export interface ArtifactDownloadTicket {
	url: string;
	fileName: string;
	mime: SharedArtifactDownloadFile["mime"];
	bytes: number;
}

interface StoredTicket extends SharedArtifactDownloadFile {
	expiresAt: number;
}

const tickets = new Map<string, StoredTicket>();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function cleanupExpired(now: number): void {
	for (const [token, ticket] of tickets) {
		if (ticket.expiresAt <= now) tickets.delete(token);
	}
}

function randomToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** Issue an in-memory capability for one already-validated artifact file. */
export function issueArtifactDownloadTicket(
	file: SharedArtifactDownloadFile,
	now: number = Date.now(),
): ArtifactDownloadTicket {
	cleanupExpired(now);
	const token = randomToken();
	tickets.set(token, { ...file, expiresAt: now + ARTIFACT_DOWNLOAD_TTL_MS });
	return {
		url: `${ARTIFACT_DOWNLOAD_ROUTE}/${token}`,
		fileName: file.fileName,
		mime: file.mime,
		bytes: file.bytes,
	};
}

/** Resolve a capability without consuming it so a failed transfer can retry before expiry. */
export function resolveArtifactDownloadTicket(token: string, now: number = Date.now()): SharedArtifactDownloadFile | null {
	cleanupExpired(now);
	if (!TOKEN_PATTERN.test(token)) return null;
	const ticket = tickets.get(token);
	if (!ticket) return null;
	const { expiresAt: _expiresAt, ...file } = ticket;
	return file;
}

export function _resetArtifactDownloadTicketsForTests(): void {
	tickets.clear();
}
