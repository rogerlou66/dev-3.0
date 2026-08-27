import { useEffect, useMemo, useState } from "react";
import { EMPTY_SPACES_FILE, orderSpaces, type Space, type SpacesFile } from "../shared/types";
import { api } from "./rpc";

/**
 * The single renderer seam for Spaces state: fetches once, then stays live via
 * the `spacesUpdated` push. Consumers never add their own fetch or listener.
 */
export function useSpaces(): { spaces: Space[]; file: SpacesFile; loading: boolean } {
	const [file, setFile] = useState<SpacesFile>(EMPTY_SPACES_FILE);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const loaded = await api.request.getSpaces({});
				if (!cancelled) setFile(loaded);
			} catch (err) {
				console.error("Failed to load spaces:", err);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		function onSpacesUpdated(e: Event) {
			const { file: next } = (e as CustomEvent).detail as { file: SpacesFile };
			setFile(next);
		}
		window.addEventListener("rpc:spacesUpdated", onSpacesUpdated);
		return () => window.removeEventListener("rpc:spacesUpdated", onSpacesUpdated);
	}, []);

	const spaces = useMemo(() => orderSpaces(file.spaces, file.order), [file]);
	return { spaces, file, loading };
}
