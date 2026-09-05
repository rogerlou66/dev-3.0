import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import Dashboard from "../Dashboard";
import { I18nProvider } from "../../i18n";
import type { Project } from "../../../shared/types";
import type { AppAction, Route } from "../../state";

vi.mock("../../rpc", () => ({
	api: {
		request: {
			removeProject: vi.fn(),
			reorderProjects: vi.fn(),
			getAllProjectTasks: vi.fn(() => Promise.resolve([])),
			getWorkspaceBoardTasks: vi.fn(() => Promise.resolve([])),
			getSpaces: vi.fn(() => Promise.resolve({ version: 1, spaces: [], order: [] })),
			reorderSpaces: vi.fn(),
			getAgents: vi.fn(() => Promise.resolve([])),
			getGlobalSettings: vi.fn(() => Promise.resolve({ defaultAgentId: "builtin-claude", defaultConfigId: "claude-default", taskSortOrder: "oldest-first", updateChannel: "stable" })),
		},
	},
}));

import { api } from "../../rpc";
import { confirm } from "../../confirm";

vi.mock("../../confirm", () => ({
	confirm: vi.fn(),
	ConfirmHost: () => null,
}));

const mockedApi = vi.mocked(api, true);

function DashboardWithHeader(props: Omit<ComponentProps<typeof Dashboard>, "headerSlot">) {
	const [slot, setSlot] = useState<HTMLDivElement | null>(null);
	return <><header data-testid="dashboard-test-header"><div ref={setSlot} /></header><main data-testid="dashboard-test-main"><Dashboard {...props} headerSlot={slot} /></main></>;
}

function renderDashboard(
	projects: Project[] = [],
	dispatch?: React.Dispatch<AppAction>,
	navigate?: (route: Route) => void,
	onOpenAddProject?: () => void,
	view: "board" | "projects" = "projects",
	onOpenCreateTask?: (projectId: string) => void,
) {
	const result = render(
		<I18nProvider>
			<DashboardWithHeader
				projects={projects}
				dispatch={dispatch ?? vi.fn()}
				navigate={navigate ?? vi.fn()}
				bellCounts={new Map()}
				onOpenAddProject={onOpenAddProject ?? vi.fn()}
				onOpenCreateTask={onOpenCreateTask ?? vi.fn()}
				workspaceBoardRequest={0}
			/>
		</I18nProvider>,
	);
	if (projects.length > 0 && view === "projects") fireEvent.click(screen.getByRole("button", { name: "Projects" }));
	return result;
}

const mockProject: Project = {
	id: "p1",
	name: "My Project",
	path: "/home/user/my-project",
	setupScript: "",
	devScript: "",
	cleanupScript: "",
	defaultBaseBranch: "main",
	createdAt: "2025-01-01T00:00:00Z",
};

describe("Dashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedApi.request.getAllProjectTasks.mockResolvedValue([]);
		mockedApi.request.getWorkspaceBoardTasks.mockResolvedValue([]);
	});

	it("opens the workspace board by default", async () => {
		renderDashboard([mockProject], vi.fn(), vi.fn(), vi.fn(), "board");
		expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
		const navigation = screen.getByRole("navigation", { name: "Dashboard views" });
		expect(await within(navigation).findByPlaceholderText("Search tasks and projects…")).toBeInTheDocument();
	});

	it("renders navigation and search in the header and retains the query across views", async () => {
		const user = userEvent.setup();
		renderDashboard([mockProject], vi.fn(), vi.fn(), vi.fn(), "board");
		const navigation = screen.getByRole("navigation", { name: "Dashboard views" });
		const search = within(navigation).getByRole("textbox", { name: "Search tasks and projects…" });

		await user.type(search, "api");
		expect(search).toHaveValue("api");
		expect(screen.getByTestId("dashboard-test-header")).toContainElement(navigation);
		expect(screen.getByTestId("dashboard-test-main")).not.toContainElement(navigation);
		expect(navigation.lastElementChild).toContainElement(search);
		await user.click(within(navigation).getByRole("button", { name: "Projects" }));
		expect(within(navigation).queryByRole("textbox")).not.toBeInTheDocument();
		await user.click(within(navigation).getByRole("button", { name: "Board" }));
		expect(within(navigation).getByRole("textbox")).toHaveValue("api");
	});

	it("returns to the workspace board when App requests it", async () => {
		const props = {
			projects: [mockProject],
			dispatch: vi.fn(),
			navigate: vi.fn(),
			bellCounts: new Map<string, number>(),
			onOpenAddProject: vi.fn(),
			onOpenCreateTask: vi.fn(),
		};
		const { rerender } = render(
			<I18nProvider>
				<DashboardWithHeader {...props} workspaceBoardRequest={0} />
			</I18nProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Projects" }));
		expect(screen.getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page");

		rerender(
			<I18nProvider>
				<DashboardWithHeader {...props} workspaceBoardRequest={1} />
			</I18nProvider>,
		);

		await waitFor(() => expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page"));
	});

	it("persists project priority changes made on the workspace board", async () => {
		const dispatch = vi.fn();
		const projects = [
			mockProject,
			{ ...mockProject, id: "p2", name: "Second", path: "/home/user/second" },
		];
		mockedApi.request.getWorkspaceBoardTasks.mockResolvedValue([
			{ projectId: "p1", tasks: [] },
			{ projectId: "p2", tasks: [] },
		]);
		mockedApi.request.reorderProjects.mockResolvedValue([projects[1], projects[0]]);

		renderDashboard(projects, dispatch, vi.fn(), vi.fn(), "board");
		const firstProject = await screen.findByRole("region", { name: "My Project" });
		const secondProject = screen.getByRole("region", { name: "Second" });
		const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
		vi.spyOn(firstProject, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
		fireEvent.dragStart(within(secondProject).getByTitle("Drag to reorder project"), { dataTransfer });
		fireEvent.dragOver(firstProject, { clientY: 25, dataTransfer });
		fireEvent.drop(firstProject, { clientY: 25, dataTransfer });

		expect(dispatch).toHaveBeenCalledWith({ type: "reorderProjects", projectIds: ["p2", "p1"] });
		expect(mockedApi.request.reorderProjects).toHaveBeenCalledWith({ projectIds: ["p2", "p1"] });
	});

	describe("empty state", () => {
		it("shows empty state message", () => {
			renderDashboard();
			expect(screen.getByText("No projects yet")).toBeInTheDocument();
			expect(screen.getByText("Add a git repository to get started")).toBeInTheDocument();
		});

		it("calls onOpenAddProject when Add Project is clicked", async () => {
			const user = userEvent.setup();
			const onOpenAddProject = vi.fn();

			renderDashboard([], vi.fn(), vi.fn(), onOpenAddProject);
			await user.click(screen.getByText("Add project"));

			expect(onOpenAddProject).toHaveBeenCalled();
		});
	});

	describe("project list", () => {
		it("renders project name and path on the activity list", async () => {
			renderDashboard([mockProject], vi.fn(), vi.fn(), vi.fn());

			expect(await screen.findByText("My Project")).toBeInTheDocument();
			expect(screen.getByText("/home/user/my-project")).toBeInTheDocument();
		});

		it("shows project count", async () => {
			renderDashboard([mockProject], vi.fn(), vi.fn(), vi.fn());
			expect(await screen.findByText("1 project")).toBeInTheDocument();
		});

		it("shows plural count for multiple projects", async () => {
			const projects = [
				mockProject,
				{ ...mockProject, id: "p2", name: "Second" },
			];

			renderDashboard(projects, vi.fn(), vi.fn(), vi.fn());
			expect(await screen.findByText("2 projects")).toBeInTheDocument();
		});

		it("keeps the persisted project order instead of sorting by active task count", async () => {
			mockedApi.request.getAllProjectTasks.mockResolvedValue([
				{
					projectId: "p2",
					tasks: [{
						id: "t1",
						projectId: "p2",
						title: "Active",
						description: "Active",
						status: "in-progress",
						movedAt: "2026-04-29T00:00:00.000Z",
					}],
				},
			] as any);
			const projects = [
				mockProject,
				{ ...mockProject, id: "p2", name: "Second", path: "/home/user/second" },
			];

			renderDashboard(projects, vi.fn(), vi.fn(), vi.fn());
			const first = await screen.findByText("My Project");
			const second = await screen.findByText("Second");

			expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		});

		it("moves a project up and persists the new order", async () => {
			const user = userEvent.setup();
			const dispatch = vi.fn();
			const projects = [
				mockProject,
				{ ...mockProject, id: "p2", name: "Second", path: "/home/user/second" },
				{ ...mockProject, id: "p3", name: "Third", path: "/home/user/third" },
			];
			mockedApi.request.reorderProjects.mockResolvedValue([projects[1], projects[0], projects[2]]);

			renderDashboard(projects, dispatch, vi.fn(), vi.fn());
			await screen.findByText("Second");
			await user.click(screen.getAllByTitle("Move project up")[1]);

			expect(dispatch).toHaveBeenCalledWith({
				type: "reorderProjects",
				projectIds: ["p2", "p1", "p3"],
			});
			expect(mockedApi.request.reorderProjects).toHaveBeenCalledWith({
				projectIds: ["p2", "p1", "p3"],
			});
			await waitFor(() => {
				expect(dispatch).toHaveBeenCalledWith({
					type: "setProjects",
					projects: [projects[1], projects[0], projects[2]],
				});
			});
		});
	});

	describe("remove project flow", () => {
		it("dispatches removeProject after confirm", async () => {
			const user = userEvent.setup();
			const dispatch = vi.fn();

			vi.mocked(confirm).mockResolvedValue(true);
			mockedApi.request.removeProject.mockResolvedValue(undefined);

			renderDashboard([mockProject], dispatch, vi.fn(), vi.fn());
			await screen.findByText("My Project");
			await user.click(screen.getByTitle("Remove"));

			expect(vi.mocked(confirm)).toHaveBeenCalled();
			expect(mockedApi.request.removeProject).toHaveBeenCalledWith({
				projectId: "p1",
			});
			expect(dispatch).toHaveBeenCalledWith({
				type: "removeProject",
				projectId: "p1",
			});
		});

		it("does nothing when confirm is cancelled", async () => {
			const user = userEvent.setup();
			const dispatch = vi.fn();

			vi.mocked(confirm).mockResolvedValue(false);

			renderDashboard([mockProject], dispatch, vi.fn(), vi.fn());
			await screen.findByText("My Project");
			await user.click(screen.getByTitle("Remove"));

			expect(mockedApi.request.removeProject).not.toHaveBeenCalled();
			expect(dispatch).not.toHaveBeenCalled();
		});
	});

	describe("space selection vs the hidden rail", () => {
		// The rail is gated on the CONTAINER's width, so the test drives layout,
		// not a media query: a fake ResizeObserver plus a pinned rect is the only
		// way to have a width at all under happy-dom.
		let originalRO: typeof globalThis.ResizeObserver;
		let originalRect: () => DOMRect;
		let observedCallbacks: ResizeObserverCallback[];
		let containerWidth: number;

		beforeEach(() => {
			originalRO = globalThis.ResizeObserver;
			originalRect = Element.prototype.getBoundingClientRect;
			observedCallbacks = [];
			containerWidth = 1440;
			Element.prototype.getBoundingClientRect = function () {
				return { width: containerWidth, height: 800, top: 0, left: 0, right: containerWidth, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
			};
			globalThis.ResizeObserver = class {
				constructor(cb: ResizeObserverCallback) {
					observedCallbacks.push(cb);
				}
				observe() {}
				unobserve() {}
				disconnect() {}
			} as unknown as typeof globalThis.ResizeObserver;
		});

		afterEach(() => {
			globalThis.ResizeObserver = originalRO;
			Element.prototype.getBoundingClientRect = originalRect;
		});

		it("keeps the selected space when the rail goes, and hands the filter to the sheet", async () => {
			const user = userEvent.setup();
			const projects = [
				mockProject,
				{ ...mockProject, id: "p2", name: "Second", path: "/home/user/second" },
			];
			mockedApi.request.getSpaces.mockResolvedValue({
				version: 1,
				spaces: [
					{ id: "s1", name: "Client X", projectIds: ["p1"], createdAt: "2026-08-01T00:00:00Z" },
				],
				order: ["s1"],
			} as any);

			renderDashboard(projects, vi.fn(), vi.fn(), vi.fn());
			await user.click(await screen.findByTestId("rail-space-s1"));

			// The selection filters the overview down to the space's member.
			expect(screen.getByText("My Project")).toBeInTheDocument();
			expect(screen.queryByText("Second")).not.toBeInTheDocument();

			containerWidth = 900;
			act(() => {
				for (const cb of observedCallbacks) {
					cb([{ contentRect: { width: containerWidth } } as ResizeObserverEntry], {} as ResizeObserver);
				}
			});

			// The rail is gone but the filter is NOT: narrowing a window must not
			// silently change what the list shows.
			expect(screen.queryByTestId("spaces-rail")).not.toBeInTheDocument();
			expect(screen.queryByText("Second")).not.toBeInTheDocument();
			const filter = screen.getByTestId("dashboard-space-filter");
			expect(filter).toHaveTextContent("Client X");

			// And it is still changeable — through the sheet that replaces the rail.
			await user.click(filter);
			await user.click(screen.getByTestId("space-filter-all"));
			expect(await screen.findByText("Second")).toBeInTheDocument();
			expect(screen.getByTestId("dashboard-space-filter")).toHaveTextContent("Everything");
		});

		it("clears a selection whose space stopped existing", async () => {
			const user = userEvent.setup();
			const projects = [
				mockProject,
				{ ...mockProject, id: "p2", name: "Second", path: "/home/user/second" },
			];
			mockedApi.request.getSpaces.mockResolvedValue({
				version: 1,
				spaces: [
					{ id: "s1", name: "Client X", projectIds: ["p1"], createdAt: "2026-08-01T00:00:00Z" },
				],
				order: ["s1"],
			} as any);

			renderDashboard(projects, vi.fn(), vi.fn(), vi.fn());
			await user.click(await screen.findByTestId("rail-space-s1"));
			expect(screen.queryByText("Second")).not.toBeInTheDocument();

			// The space is deleted elsewhere: filtering by an id nothing can select
			// again would leave the list stuck.
			act(() => {
				window.dispatchEvent(
					new CustomEvent("rpc:spacesUpdated", { detail: { file: { version: 1, spaces: [], order: [] } } }),
				);
			});

			expect(await screen.findByText("Second")).toBeInTheDocument();
		});
	});

	describe("navigation", () => {
		it("navigates to project on card click", async () => {
			const user = userEvent.setup();
			const navigate = vi.fn();

			renderDashboard([mockProject], vi.fn(), navigate, vi.fn());
			await user.click(await screen.findByText("My Project"));

			expect(navigate).toHaveBeenCalledWith({
				screen: "project",
				projectId: "p1",
			});
		});
	});

	// The project rows already list every task waiting on the user, so a panel
	// beside them rendered the same rows twice. It stays in the project view,
	// where the centre is a board rather than a task list.
	describe("no cross-project task panel", () => {
		it("renders no Active tasks panel, even with spaces in play", async () => {
			mockedApi.request.getSpaces.mockResolvedValue({
				version: 1,
				spaces: [{ id: "sp_a", name: "Client X", parentId: null, projectIds: ["p1"], createdAt: 1 }],
				order: ["sp_a"],
			});
			renderDashboard([mockProject], vi.fn(), vi.fn(), vi.fn());
			await screen.findByText("My Project");
			expect(screen.queryByRole("navigation", { name: /active tasks/i })).not.toBeInTheDocument();
		});
	});

	// The rail owns `New space`; the header only carries a fallback while the
	// rail is off screen — which is where a first-time user with zero spaces is.
	describe("New space entry point", () => {
		it("keeps the header fallback when there is no rail yet", async () => {
			// Pinned explicitly: `clearAllMocks` keeps implementations, so a
			// sibling test's spaces would leak in and hide the rail-less case.
			mockedApi.request.getSpaces.mockResolvedValue({ version: 1, spaces: [], order: [] });
			renderDashboard([mockProject], vi.fn(), vi.fn(), vi.fn());
			await screen.findByText("My Project");
			expect(screen.getByTestId("dashboard-new-space")).toBeInTheDocument();
			expect(screen.queryByTestId("spaces-rail")).not.toBeInTheDocument();
		});

		it("drops the header fallback once the rail is on screen", async () => {
			mockedApi.request.getSpaces.mockResolvedValue({
				version: 1,
				spaces: [{ id: "sp_a", name: "Client X", parentId: null, projectIds: ["p1"], createdAt: 1 }],
				order: ["sp_a"],
			});
			renderDashboard([mockProject], vi.fn(), vi.fn(), vi.fn());
			await screen.findByTestId("spaces-rail");
			expect(screen.queryByTestId("dashboard-new-space")).not.toBeInTheDocument();
			expect(screen.getByTestId("rail-new-space")).toBeInTheDocument();
		});
	});
});
