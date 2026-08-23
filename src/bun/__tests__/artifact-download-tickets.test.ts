import { beforeEach, describe, expect, it } from "vitest";
import {
	ARTIFACT_DOWNLOAD_TTL_MS,
	_resetArtifactDownloadTicketsForTests,
	issueArtifactDownloadTicket,
	resolveArtifactDownloadTicket,
} from "../artifact-download-tickets";

const file = {
	path: "/tmp/report.zip",
	fileName: "Report.zip",
	mime: "application/zip" as const,
	bytes: 42,
};

describe("artifact download tickets", () => {
	beforeEach(() => _resetArtifactDownloadTicketsForTests());

	it("issues an opaque relative URL and resolves its file metadata", () => {
		const ticket = issueArtifactDownloadTicket(file, 1_000);
		expect(ticket.url).toMatch(/^\/api\/artifact-download\/[A-Za-z0-9_-]{43}$/);
		expect(ticket).toMatchObject({ fileName: "Report.zip", mime: "application/zip", bytes: 42 });
		const token = ticket.url.split("/").pop()!;
		expect(resolveArtifactDownloadTicket(token, 1_001)).toEqual(file);
	});

	it("expires capabilities and rejects malformed tokens", () => {
		const ticket = issueArtifactDownloadTicket(file, 5_000);
		const token = ticket.url.split("/").pop()!;
		expect(resolveArtifactDownloadTicket(token, 5_000 + ARTIFACT_DOWNLOAD_TTL_MS - 1)).toEqual(file);
		expect(resolveArtifactDownloadTicket(token, 5_000 + ARTIFACT_DOWNLOAD_TTL_MS)).toBeNull();
		expect(resolveArtifactDownloadTicket("../report.zip", 5_001)).toBeNull();
	});

	it("keeps a ticket reusable while a failed transfer is still inside its TTL", () => {
		const ticket = issueArtifactDownloadTicket(file, 10_000);
		const token = ticket.url.split("/").pop()!;
		expect(resolveArtifactDownloadTicket(token, 10_001)).toEqual(file);
		expect(resolveArtifactDownloadTicket(token, 10_002)).toEqual(file);
	});
});
