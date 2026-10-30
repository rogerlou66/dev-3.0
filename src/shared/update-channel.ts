/**
 * How a build names its channel. The app no longer updates itself; what is left is the
 * display side: the release script stamps canary manifests with
 * {@link canaryDisplayVersion}, and the window title marks non-stable bundles.
 */

/** Build metadata suffix appended to the stable version for DISPLAY on canary. */
export function canaryDisplayVersion(baseVersion: string, shortSha: string): string {
	return `${baseVersion}+canary.${shortSha}`;
}

/**
 * Prefix marking a build that is NOT an ordinary stable install: "[DEV from src]" for
 * `bun run dev`, "[CANARY]" for the canary channel.
 *
 * It keys on the channel baked into the bundle, NEVER on the version string: the
 * `+canary.<sha>` suffix lives only in the published manifest and must never enter the
 * bundle's version.json, because `dev3 doctor` compares the bundle version against the
 * CLI version by string equality.
 */
export function buildChannelTitlePrefix(buildChannel?: string): string {
	if (buildChannel === "dev") return "[DEV from src] ";
	if (buildChannel === "canary") return "[CANARY] ";
	return "";
}
