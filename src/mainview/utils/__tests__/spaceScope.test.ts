import { spaceSiblingProjectIds } from "../spaceScope";
import type { Space } from "../../../shared/types";

const sp = (id: string, projectIds: string[], deleted = false): Space => ({
	id,
	name: id,
	parentId: null,
	projectIds,
	createdAt: 1,
	deleted,
});

describe("spaceSiblingProjectIds", () => {
	it("returns the deduplicated union across the project's spaces, including itself", () => {
		const spaces = [sp("a", ["p1", "p2"]), sp("b", ["p1", "p3"]), sp("c", ["p9"])];
		expect([...spaceSiblingProjectIds(spaces, "p1")!].sort()).toEqual(["p1", "p2", "p3"]);
	});

	it("returns null when the project belongs to no space", () => {
		expect(spaceSiblingProjectIds([sp("a", ["p2"])], "p1")).toBeNull();
		expect(spaceSiblingProjectIds([], "p1")).toBeNull();
	});

	it("ignores deleted spaces", () => {
		expect(spaceSiblingProjectIds([sp("a", ["p1"], true)], "p1")).toBeNull();
	});
});
