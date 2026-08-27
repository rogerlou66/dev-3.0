import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../../i18n";
import SpacePicker from "../SpacePicker";
import type { Space } from "../../../shared/types";

const spaces: Space[] = [
	{ id: "sp_a", name: "Alpha", parentId: null, projectIds: ["p1"], createdAt: 1 },
	{ id: "sp_b", name: "Beta", parentId: null, projectIds: ["p2"], createdAt: 1 },
];

function renderPicker(over?: Partial<React.ComponentProps<typeof SpacePicker>>) {
	const anchor = document.createElement("button");
	document.body.appendChild(anchor);
	const props = {
		spaces,
		selectedIds: ["sp_a"],
		onToggle: vi.fn(),
		onCreateNew: vi.fn(),
		anchorEl: anchor,
		onClose: vi.fn(),
		...over,
	};
	render(
		<I18nProvider>
			<SpacePicker {...props} />
		</I18nProvider>,
	);
	return props;
}

describe("SpacePicker", () => {
	it("lists spaces and toggles on row click", async () => {
		const user = userEvent.setup();
		const props = renderPicker();
		expect(screen.getByText("Alpha")).toBeInTheDocument();
		expect(screen.getByText("Beta")).toBeInTheDocument();
		await user.click(screen.getByTestId("space-picker-row-sp_b"));
		expect(props.onToggle).toHaveBeenCalledWith("sp_b");
	});

	it("filters with fuzzy matching and offers inline create for a new name", async () => {
		const user = userEvent.setup();
		const props = renderPicker();
		await user.type(screen.getByPlaceholderText("Search or create…"), "Gamma");
		expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
		await user.click(screen.getByTestId("space-picker-create"));
		expect(props.onCreateNew).toHaveBeenCalledWith("Gamma");
	});

	it("hides the create affordance when onCreateNew is not provided", async () => {
		const user = userEvent.setup();
		renderPicker({ onCreateNew: undefined });
		await user.type(screen.getByPlaceholderText("Search or create…"), "Gamma");
		expect(screen.queryByTestId("space-picker-create")).not.toBeInTheDocument();
	});
});
