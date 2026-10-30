// ---- Changelog ----

export interface ChangelogEntry {
	date: string; // "2026-03-01"
	type: string; // "feature" | "fix" | "refactor" | "docs" | "chore"
	slug: string; // "system-requirements-check"
	title: string; // First sentence of content (truncated to ~120 chars) — collapsed teaser
	body?: string; // Full cleaned content, present only when it has more than the title (expandable)
	short?: string; // Optional ≤6-word title for the update popover (from a "Short:" line)
	suggestedBy?: string; // GitHub username without @ (e.g. "roiros")
	issueUrl?: string; // Full GitHub issue URL (e.g. "https://github.com/h0x91b/dev-3.0/issues/191")
	issueRef?: string; // Short issue ref (e.g. "#191")
}

/**
 * Compact "what's new" summary embedded in the release `update.json` and pushed
 * to the renderer with `updateAvailable`. Features-first: the update popover
 * shows the feature titles + a rollup count and links to the full Changelog
 * screen. Absent for cross-channel updates or pre-changelog `update.json`.
 */
export interface UpdateChangelog {
	features: string[]; // Short feature titles, newest first, already capped for display
	featureCount: number; // Total new features in the release window
	fixCount: number; // Total new fixes in the release window
}
