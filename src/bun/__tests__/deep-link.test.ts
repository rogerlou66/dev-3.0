import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Project, Task } from "../../shared/types";
import {
	parseDeepLink,
	buildTaskDeepLink,
	buildProjectDeepLink,
	buildNewTaskDeepLink,
	deepLinkSchemeRegistered,
	buildSpaceDeepLink,
} from "../../shared/deep-link";

vi.mock("../spaces-data", () => ({
	loadSpacesFile: vi.fn(() => Promise.resolve({ version: 1, spaces: [], order: [] })),
}));

vi.mock("../data", () => ({
	loadProjects: vi.fn(),
	loadVirtualProjects: vi.fn(() => Promise.resolve([])),
	loadTasks: vi.fn(),
}));

import * as data from "../data";
import * as spacesData from "../spaces-data";
import { resolveDeepLink } from "../deep-link";
import {
	markPendingDeepLinkNav,
	consumePendingDeepLinkNav,
	__resetPendingDeepLinkNavForTests,
} from "../deep-link-nav";

const project = (id: string): Project => ({ id } as Project);
const task = (id: string): Task => ({ id } as Task);

describe("parseDeepLink", () => {
	it("parses a task link", () => {
		expect(parseDeepLink("dev3://task/abc-123")).toEqual({ kind: "task", taskId: "abc-123" });
	});

	it("parses a project link", () => {
		expect(parseDeepLink("dev3://project/proj-9")).toEqual({ kind: "project", projectId: "proj-9" });
	});

	it("parses a new-task link with project and text", () => {
		expect(parseDeepLink("dev3://new-task?project=p1&text=hello%20world")).toEqual({
			kind: "new-task",
			projectId: "p1",
			text: "hello world",
		});
	});

	it("parses a new-task link with no params", () => {
		expect(parseDeepLink("dev3://new-task")).toEqual({
			kind: "new-task",
			projectId: undefined,
			text: undefined,
		});
	});

	it("is case-insensitive on the host but keeps id casing", () => {
		expect(parseDeepLink("dev3://TASK/AbC")).toEqual({ kind: "task", taskId: "AbC" });
	});

	it("tolerates trailing slashes", () => {
		expect(parseDeepLink("dev3://project/p1/")).toEqual({ kind: "project", projectId: "p1" });
	});

	it("rejects the wrong scheme", () => {
		expect(parseDeepLink("https://task/abc")).toBeNull();
	});

	it("rejects an unknown host", () => {
		expect(parseDeepLink("dev3://bogus/abc")).toBeNull();
	});

	it("rejects a task link with no id", () => {
		expect(parseDeepLink("dev3://task/")).toBeNull();
	});

	it("rejects a non-URL string", () => {
		expect(parseDeepLink("not a url")).toBeNull();
	});
});

describe("build* + round-trip", () => {
	it("builds and re-parses a task link", () => {
		expect(parseDeepLink(buildTaskDeepLink("t1"))).toEqual({ kind: "task", taskId: "t1" });
	});

	it("builds and re-parses a project link", () => {
		expect(parseDeepLink(buildProjectDeepLink("p1"))).toEqual({ kind: "project", projectId: "p1" });
		expect(parseDeepLink(buildSpaceDeepLink("sp 1/x"))).toEqual({ kind: "space", spaceId: "sp 1/x" });
	});

	it("round-trips new-task text with special characters", () => {
		const text = "fix: café & <naïve> \"quotes\"\nnewline 日本語";
		const parsed = parseDeepLink(buildNewTaskDeepLink({ projectId: "p1", text }));
		expect(parsed).toEqual({ kind: "new-task", projectId: "p1", text });
	});

	it("omits absent params", () => {
		expect(buildNewTaskDeepLink()).toBe("dev3://new-task");
	});

	it("round-trips an id that needs escaping, like the web link does", () => {
		expect(parseDeepLink(buildTaskDeepLink("a/b c"))).toEqual({ kind: "task", taskId: "a/b c" });
	});

	it("keeps an unescaped legacy link readable", () => {
		expect(parseDeepLink("dev3://task/plain-id")).toEqual({ kind: "task", taskId: "plain-id" });
	});
});

describe("resolveDeepLink", () => {
	beforeEach(() => {
		vi.mocked(data.loadProjects).mockResolvedValue([project("p1"), project("p2")]);
		vi.mocked(data.loadVirtualProjects).mockResolvedValue([project("ops")]);
		vi.mocked(data.loadTasks).mockImplementation(async (p: Project) =>
			p.id === "p2" ? [task("t-in-p2")] : [],
		);
	});

	it("resolves a task to its owning project", async () => {
		expect(await resolveDeepLink({ kind: "task", taskId: "t-in-p2" })).toEqual({
			kind: "task",
			taskId: "t-in-p2",
			projectId: "p2",
		});
	});

	it("returns null for an unknown task", async () => {
		expect(await resolveDeepLink({ kind: "task", taskId: "ghost" })).toBeNull();
	});

	it("resolves an existing project (including virtual)", async () => {
		expect(await resolveDeepLink({ kind: "project", projectId: "ops" })).toEqual({
			kind: "project",
			projectId: "ops",
		});
	});

	it("returns null for an unknown project", async () => {
		expect(await resolveDeepLink({ kind: "project", projectId: "nope" })).toBeNull();
	});

	it("resolves a space to its first member project that exists here", async () => {
		vi.mocked(spacesData.loadSpacesFile).mockResolvedValue({
			version: 1,
			spaces: [{ id: "sp_1", name: "Client X", parentId: null, projectIds: ["ghost", "p2"], createdAt: 1 }],
			order: ["sp_1"],
		});
		expect(await resolveDeepLink({ kind: "space", spaceId: "sp_1" })).toEqual({
			kind: "space",
			spaceId: "sp_1",
			projectId: "p2",
		});
	});

	it("returns null for a deleted space, and for one whose members are all gone", async () => {
		vi.mocked(spacesData.loadSpacesFile).mockResolvedValue({
			version: 1,
			spaces: [
				{ id: "sp_dead", name: "Gone", parentId: null, projectIds: ["p1"], createdAt: 1, deleted: true },
				{ id: "sp_empty", name: "Empty", parentId: null, projectIds: ["ghost"], createdAt: 1 },
			],
			order: [],
		});
		expect(await resolveDeepLink({ kind: "space", spaceId: "sp_dead" })).toBeNull();
		expect(await resolveDeepLink({ kind: "space", spaceId: "sp_empty" })).toBeNull();
		expect(await resolveDeepLink({ kind: "space", spaceId: "sp_never" })).toBeNull();
	});

	it("keeps a valid requested project for new-task", async () => {
		expect(await resolveDeepLink({ kind: "new-task", projectId: "p2", text: "hi" })).toEqual({
			kind: "new-task",
			projectId: "p2",
			text: "hi",
		});
	});

	it("falls back to the first project when new-task omits one", async () => {
		expect(await resolveDeepLink({ kind: "new-task" })).toEqual({
			kind: "new-task",
			projectId: "p1",
			text: "",
		});
	});

	it("falls back to the first project when new-task names a missing one", async () => {
		const nav = await resolveDeepLink({ kind: "new-task", projectId: "gone", text: "x" });
		expect(nav).toEqual({ kind: "new-task", projectId: "p1", text: "x" });
	});

	it("returns null for new-task when there are no projects at all", async () => {
		vi.mocked(data.loadProjects).mockResolvedValue([]);
		vi.mocked(data.loadVirtualProjects).mockResolvedValue([]);
		expect(await resolveDeepLink({ kind: "new-task", text: "x" })).toBeNull();
	});
});

describe("pending deep-link nav slot", () => {
	beforeEach(() => __resetPendingDeepLinkNavForTests());

	it("read-and-clears the stored target", () => {
		markPendingDeepLinkNav({ kind: "project", projectId: "p1" });
		expect(consumePendingDeepLinkNav()).toEqual({ kind: "project", projectId: "p1" });
		expect(consumePendingDeepLinkNav()).toBeNull();
	});
});

// Only the macOS bundle registers the scheme; a link is inert everywhere else,
// which determines whether local links can be opened by the OS.
describe("deepLinkSchemeRegistered", () => {
	it("is true on macOS and false on every other platform", () => {
		expect(deepLinkSchemeRegistered("darwin")).toBe(true);
		expect(deepLinkSchemeRegistered("win32")).toBe(false);
		expect(deepLinkSchemeRegistered("linux")).toBe(false);
	});
});
