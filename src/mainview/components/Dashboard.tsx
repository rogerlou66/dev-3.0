import { useState, type Dispatch } from "react";
import { toast } from "../toast";
import type { Project } from "../../shared/types";
import { orderProjectsForDisplay } from "../../shared/types";
import type { AppAction, Route } from "../state";
import { api } from "../rpc";
import { confirm } from "../confirm";
import { useT } from "../i18n";
import ActivityOverview from "./ActivityOverview";
import WorkspaceBoard from "./WorkspaceBoard";

interface DashboardProps {
	projects: Project[];
	dispatch: Dispatch<AppAction>;
	navigate: (route: Route) => void;
	bellCounts: Map<string, number>;
	onOpenAddProject: () => void;
	onOpenCreateTask: (projectId: string) => void;
}

function Dashboard({ projects, dispatch, navigate, bellCounts, onOpenAddProject, onOpenCreateTask }: DashboardProps) {
	const t = useT();
	const [surface, setSurface] = useState<"board" | "projects">("board");
	const [workspaceQuery, setWorkspaceQuery] = useState("");

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
			// reorderProjects only operates on git projects.json — re-merge virtual
			// boards (Operations) so they are not wiped from state on confirmation.
			const virtuals = previousProjects.filter((p) => p.kind === "virtual");
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
			<div className="flex-1 overflow-hidden">
				{projects.length > 0 ? (
					surface === "board" ? <WorkspaceBoard
						projects={projects}
						query={workspaceQuery}
						dispatch={dispatch}
						navigate={navigate}
						bellCounts={bellCounts}
						onOpenCreateTask={onOpenCreateTask}
					/> : <ActivityOverview
						projects={projects}
						dispatch={dispatch}
						navigate={navigate}
						bellCounts={bellCounts}
						onRemoveProject={handleRemoveProject}
						onOpenAddProject={onOpenAddProject}
						onReorderProjects={handleReorderProjects}
					/>
				) : (
					<div className="h-full overflow-y-auto p-3 md:p-7">
						<div className="flex flex-col items-center justify-center h-full">
							<div className="w-20 h-20 rounded-2xl bg-raised flex items-center justify-center mb-5">
								<svg
									aria-hidden="true"
									focusable="false"
									className="w-10 h-10 text-fg-3"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={1.5}
										d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
									/>
								</svg>
							</div>
							<h2 className="text-fg-2 text-lg font-medium mb-1 text-center text-pretty max-w-xs">
								{t("dashboard.noProjects")}
							</h2>
							<p className="text-fg-3 text-sm mb-5 text-center text-pretty max-w-xs">
								{t("dashboard.noProjectsHint")}
							</p>
							<button
								onClick={onOpenAddProject}
								className="px-5 py-2 bg-accent-fill text-white text-sm font-semibold rounded-xl hover:bg-accent-fill-hover shadow-lg shadow-accent/20 transition-[background-color,transform] active:scale-[0.96]"
							>
								{t("dashboard.addProject")}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export default Dashboard;
