import { useEffect, useState } from "react";
import type { ModelCatalogView } from "../../../shared/types";
import { api } from "../../rpc";

/** The saved catalog, or null while it loads or when it cannot be read. Both
 *  the roles editor and the command preview need it, and neither owns the
 *  error: the catalog settings surface does. */
export function useModelCatalog(): ModelCatalogView | null {
	const [catalog, setCatalog] = useState<ModelCatalogView | null>(null);

	useEffect(() => {
		let cancelled = false;
		void api.request
			.modelCatalogGet()
			.then((view) => {
				if (!cancelled) setCatalog(view);
			})
			.catch(() => {
				/* stays null — the surface that owns the catalog reports it */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return catalog;
}
