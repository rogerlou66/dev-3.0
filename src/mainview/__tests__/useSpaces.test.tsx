import { render, screen, waitFor } from "@testing-library/react";
import { useSpaces } from "../useSpaces";
import type { SpacesFile } from "../../shared/types";

const file: SpacesFile = {
	version: 1,
	spaces: [
		{ id: "sp_b", name: "Beta", parentId: null, projectIds: ["p2"], createdAt: 1 },
		{ id: "sp_a", name: "Alpha", parentId: null, projectIds: ["p1"], createdAt: 1 },
		{ id: "sp_x", name: "Gone", parentId: null, projectIds: ["p1"], createdAt: 1, deleted: true },
	],
	order: ["sp_a", "sp_b"],
};

vi.mock("../rpc", () => ({
	api: { request: { getSpaces: vi.fn(() => Promise.resolve(file)) } },
}));

function Probe() {
	const { spaces, loading } = useSpaces();
	return (
		<div>
			<span data-testid="loading">{String(loading)}</span>
			<span data-testid="names">{spaces.map((s) => s.name).join(",")}</span>
		</div>
	);
}

describe("useSpaces", () => {
	it("fetches once on mount and returns ordered, non-deleted spaces", async () => {
		const { api } = await import("../rpc");
		render(<Probe />);
		await waitFor(() => {
			expect(screen.getByTestId("names")).toHaveTextContent("Alpha,Beta");
		});
		expect(screen.getByTestId("loading")).toHaveTextContent("false");
		expect(api.request.getSpaces).toHaveBeenCalledTimes(1);
	});

	it("replaces state from an rpc:spacesUpdated push without another fetch", async () => {
		const { api } = await import("../rpc");
		render(<Probe />);
		await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("Alpha,Beta"));

		const updated: SpacesFile = {
			version: 1,
			spaces: [{ id: "sp_c", name: "Gamma", parentId: null, projectIds: ["p3"], createdAt: 2 }],
			order: ["sp_c"],
		};
		window.dispatchEvent(new CustomEvent("rpc:spacesUpdated", { detail: { file: updated } }));
		await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("Gamma"));
		expect(api.request.getSpaces).toHaveBeenCalledTimes(2); // once per render() in this test file
	});
});
