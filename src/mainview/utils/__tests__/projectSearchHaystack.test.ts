import { projectSearchHaystack } from "../projectSearchHaystack";
import type { Space } from "../../../shared/types";

const sp = (id: string, name: string, projectIds: string[]): Space => ({
	id,
	name,
	parentId: null,
	projectIds,
	createdAt: 1,
});

describe("projectSearchHaystack", () => {
	it("starts with the display name and appends space names", () => {
		const spaces = [sp("a", "Client X", ["p1"]), sp("b", "Infra", ["p1", "p2"])];
		expect(projectSearchHaystack("api-server", spaces, "p1")).toBe("api-server Client X Infra");
	});

	it("returns just the name when the project is in no space", () => {
		expect(projectSearchHaystack("api-server", [sp("a", "Client X", ["p2"])], "p1")).toBe("api-server");
	});
});
