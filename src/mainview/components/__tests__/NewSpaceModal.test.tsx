import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../../i18n";
import NewSpaceModal from "../NewSpaceModal";
import type { Project } from "../../../shared/types";

vi.mock("../../rpc", () => ({
	api: {
		request: {
			createSpace: vi.fn(() =>
				Promise.resolve({ id: "sp_new", name: "X", parentId: null, projectIds: ["p1"], createdAt: 1 }),
			),
		},
	},
}));

const proj = (id: string, over?: Partial<Project>): Project => ({
	id,
	name: id,
	path: `/tmp/${id}`,
	setupScript: "",
	devScript: "",
	cleanupScript: "",
	defaultBaseBranch: "main",
	createdAt: "2025-01-01T00:00:00Z",
	...over,
});

describe("NewSpaceModal", () => {
	it("keeps Create disabled until a name and at least one project are set", async () => {
		const user = userEvent.setup();
		render(
			<I18nProvider>
				<NewSpaceModal projects={[proj("p1"), proj("p2")]} onClose={vi.fn()} />
			</I18nProvider>,
		);
		const create = screen.getByTestId("new-space-create");
		expect(create).toBeDisabled();

		await user.type(screen.getByTestId("new-space-name"), "Client X");
		expect(create).toBeDisabled();

		await user.click(screen.getByTestId("new-space-project-p1"));
		expect(create).toBeEnabled();
	});

	it("submits createSpace with the chosen members and closes", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		const { api } = await import("../../rpc");
		render(
			<I18nProvider>
				<NewSpaceModal projects={[proj("p1"), proj("p2")]} onClose={onClose} />
			</I18nProvider>,
		);
		await user.type(screen.getByTestId("new-space-name"), "Client X");
		await user.click(screen.getByTestId("new-space-project-p1"));
		await user.click(screen.getByTestId("new-space-project-p2"));
		await user.click(screen.getByTestId("new-space-create"));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(api.request.createSpace).toHaveBeenCalledWith({ name: "Client X", projectIds: ["p1", "p2"] });
	});

	it("excludes the builtin Operations board from the candidate list", () => {
		render(
			<I18nProvider>
				<NewSpaceModal
					projects={[proj("p1"), proj("ops", { kind: "virtual", builtin: true })]}
					onClose={vi.fn()}
				/>
			</I18nProvider>,
		);
		expect(screen.queryByTestId("new-space-project-ops")).not.toBeInTheDocument();
	});
});
