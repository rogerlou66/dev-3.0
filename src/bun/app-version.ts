import { Updater } from "./electrobun-platform";

/** The running bundle's own build identity, read from its version.json — never fetched. */
export async function getLocalVersion(): Promise<{ version: string; hash: string; channel: string }> {
	const [version, hash, channel] = await Promise.all([
		Updater.localInfo.version(),
		Updater.localInfo.hash(),
		Updater.localInfo.channel(),
	]);
	return { version, hash, channel };
}
