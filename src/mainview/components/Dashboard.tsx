import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import { toast } from "../toast";
import type { Project, Space, Task } from "../../shared/types";
import { isBuiltinOpsProject, isSpaceSensitive, orderProjectsForDisplay } from "../../shared/types";
import { HOME_GROUP_ID } from "../utils/spaceGroups";
import type { AppAction, Route } from "../state";
import { api } from "../rpc";
import { confirm } from "../confirm";
import { useT } from "../i18n";
import { useSpaces } from "../useSpaces";
import { useContainerWidth } from "../hooks/useContainerWidth";
import { deleteSpaceWithConfirm, moveSpace, renameSpace, toggleSpaceSensitive } from "../utils/spaceActions";
import ActivityOverview from "./ActivityOverview";
import WorkspaceBoard from "./WorkspaceBoard";
import SpacesRail, { SPACES_RAIL_MIN_WIDTH } from "./SpacesRail";
import NewSpaceModal from "./NewSpaceModal";
import SpaceProjectsModal from "./SpaceProjectsModal";
import SpaceFilterSheet from "./SpaceFilterSheet";

interface DashboardProps {
	projects: Project[];
	dispatch: Dispatch<AppAction>;
	navigate: (route: Route) => void;
	bellCounts: Map<string, number>;
	onOpenAddProject: (spaceIds?: string[]) => void;
	onOpenCreateTask: (projectId: string) => void;
	onOpenWorkspaceTask?: (project: Project, task: Task, tasks: Task[], trigger: HTMLElement | null) => void;
	workspaceBoardRequest: number;
}

function Dashboard({
	projects,
	dispatch,
	navigate,
	bellCounts,
	onOpenAddProject,
	onOpenCreateTask,
	onOpenWorkspaceTask,
	workspaceBoardRequest,
}: DashboardProps) {
	const t = useT();
	const { spaces } = useSpaces();
	const [surface, setSurface] = useState<"board" | "projects">("board");
	const [workspaceQuery, setWorkspaceQuery] = useState("");
	const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
	const [showNewSpace, setShowNewSpace] = useState(false);
	const [editSpace, setEditSpace] = useState<Space | null>(null);
	const [showSpaceFilter, setShowSpaceFilter] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const containerWidth = useContainerWidth(containerRef);
	const railHidden = (containerWidth || window.innerWidth) < SPACES_RAIL_MIN_WIDTH;

	useEffect(() => {
		setSurface("board");
	}, [workspaceBoardRequest]);

	useEffect(() => {
		if (!selectedSpaceId || selectedSpaceId === HOME_GROUP_ID) return;
		if (!spaces.some((space) => space.id === selectedSpaceId)) setSelectedSpaceId(null);
	}, [spaces, selectedSpaceId]);

	const hasSpaces = spaces.length > 0;
	const railOnScreen = surface === "projects" && hasSpaces && projects.length > 0 && !railHidden;
	const railCounts = useMemo(() => {
		const ordinary = projects.filter((project) => !project.deleted && !isBuiltinOpsProject(project));
		const known = new Set(ordinary.map((project) => project.id));
		const perSpace = new Map<string, number>();
		const associated = new Set<string>();
		for (const space of spaces) {
			const members = space.projectIds.filter((id) => known.has(id));
			perSpace.set(space.id, members.length);
			for (const id of members) associated.add(id);
		}
		return {
			perSpace,
			total: projects.filter((project) => !project.deleted).length,
			home: ordinary.filter((project) => !associated.has(project.id)).length,
		};
	}, [projects, spaces]);

	const maskedSpaceIds = useMemo(() => {
		const sensitive = new Set(projects.filter((project) => project.sensitive).map((project) => project.id));
		return new Set(spaces.filter((space) => isSpaceSensitive(space, sensitive)).map((space) => space.id));
	}, [projects, spaces]);

	async function handleReorderSpaces(order: string[]) {
		try {
			await api.request.reorderSpaces({ order });
		} catch (err) {
			toast.error(t("spaces.failedUpdate", { error: String(err) }), { source: "dashboard" });
		}
	}

	async function handleRemoveProject(projectId: string) {
		const confirmed = await confirm({
			title: t("dashboard.confirmRemoveTitle"),
			message: t("dashboard.confirmRemove"),
			confirmLabel: t("dashboard.confirmRemoveAction"),
			danger: true,
		});
		if (!confirmed) return;
		try {
			await api.request.removeProject({ projectId });
			dispatch({ type: "removeProject", projectId });
		} catch (err) {
			toast.error(t("dashboard.failedRemove", { error: String(err) }), { projectId });
		}
	}

	async function handleReorderProjects(projectIds: string[]) {
		const previousProjects = projects;
		dispatch({ type: "reorderProjects", projectIds });
		try {
			const reordered = await api.request.reorderProjects({ projectIds });
			const virtuals = previousProjects.filter((project) => project.kind === "virtual");
			dispatch({ type: "setProjects", projects: orderProjectsForDisplay([...reordered, ...virtuals]) });
		} catch (err) {
			dispatch({ type: "setProjects", projects: previousProjects });
			toast.error(t("dashboard.failedReorder", { error: String(err) }), { source: "dashboard" });
		}
	}

	return (
		<div className="h-full w-full flex flex-col">
			{projects.length > 0 && (
				<nav className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-edge px-3" aria-label={t("dashboard.views")}>
					{(["board", "projects"] as const).map((view) => (
						<button
							key={view}
							type="button"
							onClick={() => setSurface(view)}
							aria-current={surface === view ? "page" : undefined}
							className={`h-full border-b-2 px-4 text-sm font-semibold transition-colors ${surface === view ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg"}`}
						>
							{t(view === "board" ? "dashboard.tabBoard" : "dashboard.tabProjects")}
						</button>
					))}
					{surface === "board" && (
						<div className="relative ml-auto min-w-0 flex-1 max-w-sm">
							<svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
							<input
								aria-label={t("workspaceBoard.search")}
								value={workspaceQuery}
								onChange={(event) => setWorkspaceQuery(event.target.value)}
								placeholder={t("workspaceBoard.search")}
								className="h-8 w-full rounded-lg border border-edge bg-base/50 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent"
							/>
						</div>
					)}
				</nav>
			)}
			<div ref={containerRef} className="flex-1 overflow-hidden flex">
				{railOnScreen && (
					<SpacesRail
						spaces={spaces}
						projectCountOf={(id) => railCounts.perSpace.get(id) ?? 0}
						maskedSpaceIds={maskedSpaceIds}
						totalProjects={railCounts.total}
						homeCount={railCounts.home}
						selectedSpaceId={selectedSpaceId}
						onSelect={setSelectedSpaceId}
						onNewSpace={() => setShowNewSpace(true)}
						onReorder={handleReorderSpaces}
						onRenameSpace={(space, name) => void renameSpace(space, name, t)}
						onDeleteSpace={(space) => void deleteSpaceWithConfirm(space, t)}
						onMoveSpace={(space, delta) => void moveSpace(space, delta, spaces, t)}
						onEditProjects={setEditSpace}
						onToggleSensitive={(space, next) => void toggleSpaceSensitive(space, next, t)}
					/>
				)}
				<div className="flex-1 min-w-0 overflow-hidden">
					{projects.length > 0 ? (
						surface === "board" ? (
							<WorkspaceBoard
								projects={projects}
								query={workspaceQuery}
								dispatch={dispatch}
								navigate={navigate}
								bellCounts={bellCounts}
								onOpenCreateTask={onOpenCreateTask}
								onOpenAddProject={onOpenAddProject}
								onOpenWorkspaceTask={onOpenWorkspaceTask}
								onReorderProjects={handleReorderProjects}
							/>
						) : (
							<ActivityOverview
								projects={projects}
								dispatch={dispatch}
								navigate={navigate}
								bellCounts={bellCounts}
								onRemoveProject={handleRemoveProject}
								onOpenAddProject={onOpenAddProject}
								onReorderProjects={handleReorderProjects}
								selectedSpaceId={selectedSpaceId}
								onNewSpace={railOnScreen ? undefined : () => setShowNewSpace(true)}
								onEditSpaceProjects={setEditSpace}
								spaceFilter={hasSpaces && !railOnScreen ? {
									label:
										selectedSpaceId === null
											? t("spaces.railAllProjects")
											: selectedSpaceId === HOME_GROUP_ID
												? t("spaces.homeGroup")
												: spaces.find((space) => space.id === selectedSpaceId)?.name ?? t("spaces.railAllProjects"),
									masked: !!selectedSpaceId && maskedSpaceIds.has(selectedSpaceId),
									onOpen: () => setShowSpaceFilter(true),
								} : undefined}
							/>
						)
					) : (
						<div className="h-full overflow-y-auto p-3 md:p-7">
							<div className="flex flex-col items-center justify-center h-full">
								<div className="w-20 h-20 rounded-2xl bg-raised flex items-center justify-center mb-5">
									<svg aria-hidden="true" focusable="false" className="w-10 h-10 text-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
									</svg>
								</div>
								<h2 className="text-fg-2 text-lg font-medium mb-1 text-center text-pretty max-w-xs">{t("dashboard.noProjects")}</h2>
								<p className="text-fg-3 text-sm mb-5 text-center text-pretty max-w-xs">{t("dashboard.noProjectsHint")}</p>
								<button onClick={() => onOpenAddProject()} className="px-5 py-2 bg-accent-fill text-white text-sm font-semibold rounded-xl hover:bg-accent-fill-hover shadow-lg shadow-accent/20 transition-[background-color,transform] active:scale-[0.96]">
									{t("dashboard.addProject")}
								</button>
							</div>
						</div>
					)}
				</div>
			</div>
			{showSpaceFilter && (
				<SpaceFilterSheet
					spaces={spaces}
					maskedSpaceIds={maskedSpaceIds}
					projectCountOf={(id) => railCounts.perSpace.get(id) ?? 0}
					totalProjects={railCounts.total}
					homeCount={railCounts.home}
					selectedSpaceId={selectedSpaceId}
					onSelect={setSelectedSpaceId}
					onClose={() => setShowSpaceFilter(false)}
				/>
			)}
			{showNewSpace && <NewSpaceModal projects={projects} onClose={() => setShowNewSpace(false)} />}
			{editSpace && (
				<SpaceProjectsModal
					space={editSpace}
					projects={projects}
					onClose={() => setEditSpace(null)}
					onCreateProject={(space) => {
						setEditSpace(null);
						onOpenAddProject([space.id]);
					}}
				/>
			)}
		</div>
	);
}

export default Dashboard;
