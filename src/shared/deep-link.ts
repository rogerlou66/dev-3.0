// dev3:// deep-link vocabulary — the one place the URL grammar lives.
//
// Both sides depend on this pure module: the bun `open-url` receiver parses
// inbound links, the renderer builds outbound "Copy deep link" strings. Keeping
// build+parse together guarantees they never drift.
//
// Grammar (host = intent, id in the path, params in the query):
//   dev3://task/<taskId>
//   dev3://project/<projectId>
//   dev3://space/<spaceId>
//   dev3://new-task?project=<projectId>&text=<url-encoded>
//
// macOS-only in practice (Electrobun registers CFBundleURLTypes; Windows/Linux
// have no scheme registration yet) — see decisions/2026/08/04/dev3-url-scheme-deep-links.md.

export const DEEP_LINK_SCHEME = "dev3";

/**
 * Whether the OS has a handler for `dev3://` at all. Only the macOS bundle
 * registers the scheme (CFBundleURLTypes); nothing in this codebase writes a
 * Windows registry key or a Linux `.desktop` MimeType entry, so a deep link is
 * inert everywhere else.
 */
export function deepLinkSchemeRegistered(platform: NodeJS.Platform = process.platform): boolean {
	return platform === "darwin";
}

/** Parsed intent of an inbound deep link (before backend resolution). */
export type DeepLinkTarget =
	| { kind: "task"; taskId: string }
	| { kind: "project"; projectId: string }
	| { kind: "space"; spaceId: string }
	| { kind: "new-task"; projectId?: string; text?: string };

/**
 * Backend-resolved deep link handed to the renderer: the referenced ids are
 * verified to exist, and `new-task` always carries a concrete `projectId`
 * (resolved to a fallback project when the link omitted one).
 */
export type DeepLinkNav =
	| { kind: "task"; taskId: string; projectId: string }
	| { kind: "project"; projectId: string }
	/** A space board still names the project it opens on — see `routeSpaceId`. */
	| { kind: "space"; spaceId: string; projectId: string }
	| { kind: "new-task"; projectId: string; text: string };

const stripSlashes = (s: string) => s.replace(/^\/+/, "").replace(/\/+$/, "");

/** Ids travel percent-encoded in both the path and the query, so both sides decode. */
const decodeId = (s: string) => {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
};

/**
 * Parse a `dev3://…` URL into a target, or `null` when it is malformed or of an
 * unknown kind. Tolerant of case in the host and of trailing slashes; ids and
 * text keep their original casing.
 */
export function parseDeepLink(raw: string): DeepLinkTarget | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;

	const kind = url.hostname.toLowerCase();
	switch (kind) {
		case "task": {
			const taskId = decodeId(stripSlashes(url.pathname));
			return taskId ? { kind: "task", taskId } : null;
		}
		case "project": {
			const projectId = decodeId(stripSlashes(url.pathname));
			return projectId ? { kind: "project", projectId } : null;
		}
		case "space": {
			const spaceId = decodeId(stripSlashes(url.pathname));
			return spaceId ? { kind: "space", spaceId } : null;
		}
		case "new-task": {
			const projectId = url.searchParams.get("project") || undefined;
			const text = url.searchParams.get("text") || undefined;
			return { kind: "new-task", projectId, text };
		}
		default:
			return null;
	}
}

/** `dev3://task/<taskId>` */
export function buildTaskDeepLink(taskId: string): string {
	return `${DEEP_LINK_SCHEME}://task/${encodeURIComponent(taskId)}`;
}

/** `dev3://project/<projectId>` */
export function buildProjectDeepLink(projectId: string): string {
	return `${DEEP_LINK_SCHEME}://project/${encodeURIComponent(projectId)}`;
}

/** `dev3://space/<spaceId>` — the space's unified board. */
export function buildSpaceDeepLink(spaceId: string): string {
	return `${DEEP_LINK_SCHEME}://space/${encodeURIComponent(spaceId)}`;
}

/** `dev3://new-task?project=…&text=…` — both params optional. */
export function buildNewTaskDeepLink(opts?: { projectId?: string; text?: string }): string {
	const params = new URLSearchParams();
	if (opts?.projectId) params.set("project", opts.projectId);
	if (opts?.text) params.set("text", opts.text);
	const qs = params.toString();
	return `${DEEP_LINK_SCHEME}://new-task${qs ? `?${qs}` : ""}`;
}
