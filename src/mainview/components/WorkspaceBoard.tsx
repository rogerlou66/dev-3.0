import { useCallback, useEffect, useMemo, useState, type Dispatch, type DragEvent } from "react";
import type { CodingAgent, GlobalSettings, Project, Task, TaskStatus } from "../../shared/types";
import { getAllowedTransitions, getTaskTitle, isBuiltinOpsProject, orderProjectsForDisplay } from "../../shared/types";
import type { AppAction, Route } from "../state";
import { getTaskOpenMode } from "../state";
import { useT, statusKey } from "../i18n";
import { api } from "../rpc";
import { toast } from "../toast";
import { useStatusColors } from "../hooks/useStatusColors";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { moveTaskToStatus } from "../utils/moveTaskToStatus";
import { sortTasksForColumn } from "./sortTasks";
import TaskCard from "./TaskCard";
import LaunchVariantsModal from "./LaunchVariantsModal";
import MobileBoardCarousel, { CAROUSEL_MAX_WIDTH, type CarouselColumn } from "./MobileBoardCarousel";

type WorkspaceColumnId = TaskStatus | "custom";
type WorkspaceTasksResult = { projectId: string; tasks: Task[]; error?: string };

interface WorkspaceBoardProps {
	projects: Project[];
	query: string;
	dispatch: Dispatch<AppAction>;
	navigate: (route: Route) => void;
	bellCounts: Map<string, number>;
	onOpenCreateTask: (projectId: string) => void;
	onOpenWorkspaceTask?: (project: Project, task: Task, tasks: Task[], trigger: HTMLElement | null) => void;
	onReorderProjects?: (projectIds: string[]) => void | Promise<void>;
}

const BASE_COLUMNS: WorkspaceColumnId[] = ["todo", "in-progress", "review-by-user", "review-by-colleague", "completed"];
const WORKSPACE_CELL_TASK_LIMIT = 15;
const COMPLETED_COLLAPSED_TASK_LIMIT = 2;
type ProjectDropSide = "before" | "after";

function WorkspaceBoard({ projects, query, dispatch, navigate, bellCounts, onOpenCreateTask, onOpenWorkspaceTask, onReorderProjects }: WorkspaceBoardProps) {
	const t = useT();
	const statusColors = useStatusColors();
	const isNarrow = useNarrowViewport(CAROUSEL_MAX_WIDTH);
	const [tasksByProject, setTasksByProject] = useState<Map<string, Task[]>>(new Map());
	const [agents, setAgents] = useState<CodingAgent[]>([]);
	const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
		defaultAgentId: "builtin-claude",
		defaultConfigId: "claude-auto",
		taskSortOrder: "oldest-first",
		updateChannel: "stable",
	});
	const [loading, setLoading] = useState(true);
	const [loadErrors, setLoadErrors] = useState<string[]>([]);
	const [dragged, setDragged] = useState<{ projectId: string; taskId: string; status: TaskStatus } | null>(null);
	const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
	const [projectDropTarget, setProjectDropTarget] = useState<{ projectId: string; side: ProjectDropSide } | null>(null);
	const [movingTaskIds, setMovingTaskIds] = useState<Set<string>>(new Set());
	const [expandedCompletedProjects, setExpandedCompletedProjects] = useState<Set<string>>(new Set());
	const [launchModal, setLaunchModal] = useState<{ task: Task; project: Project; targetStatus: TaskStatus; mode?: "spawn" | "addAttempts" } | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const results = await api.request.getWorkspaceBoardTasks() as WorkspaceTasksResult[];
			setTasksByProject(new Map(results.map((result) => [result.projectId, result.tasks])));
			setLoadErrors(results.filter((result) => result.error).map((result) => result.projectId));
		} catch (err) {
			toast.error(t("workspaceBoard.failedLoad", { error: String(err) }), { source: "dashboard" });
			setLoadErrors(["workspace"]);
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		load();
		api.request.getAgents().then(setAgents).catch(() => {});
		api.request.getGlobalSettings().then(setGlobalSettings).catch(() => {});
	}, [load]);

	useEffect(() => {
		function onTaskUpdated(event: Event) {
			const { projectId, task } = (event as CustomEvent<{ projectId: string; task: Task }>).detail;
			setTasksByProject((previous) => {
				const next = new Map(previous);
				const current = next.get(projectId) ?? [];
				next.set(projectId, current.some((candidate) => candidate.id === task.id)
					? current.map((candidate) => candidate.id === task.id ? task : candidate)
					: [...current, task]);
				return next;
			});
		}
		function onTaskRemoved(event: Event) {
			const { projectId, taskId } = (event as CustomEvent<{ projectId: string; taskId: string }>).detail;
			setTasksByProject((previous) => {
				const next = new Map(previous);
				next.set(projectId, (next.get(projectId) ?? []).filter((task) => task.id !== taskId));
				return next;
			});
		}
		window.addEventListener("rpc:taskUpdated", onTaskUpdated);
		window.addEventListener("rpc:taskRemoved", onTaskRemoved);
		return () => {
			window.removeEventListener("rpc:taskUpdated", onTaskUpdated);
			window.removeEventListener("rpc:taskRemoved", onTaskRemoved);
		};
	}, []);

	useEffect(() => {
		const clearDrag = () => {
			setDragged(null);
			setDraggedProjectId(null);
			setProjectDropTarget(null);
		};
		window.addEventListener("dragend", clearDrag);
		return () => window.removeEventListener("dragend", clearDrag);
	}, []);

	const orderedProjects = useMemo(
		() => orderProjectsForDisplay(projects.filter((project) => !project.deleted)),
		[projects],
	);
	const allTasks = useMemo(() => [...tasksByProject.values()].flat(), [tasksByProject]);
	const columns = useMemo(() => {
		const next = [...BASE_COLUMNS];
		if (allTasks.some((task) => task.status === "review-by-ai")) next.splice(2, 0, "review-by-ai");
		if (allTasks.some((task) => task.customColumnId)) {
			const completedIndex = next.indexOf("completed");
			next.splice(completedIndex, 0, "custom");
		}
		return next;
	}, [allTasks]);

	function reorderProject(sourceProjectId: string, targetProjectId: string, side: ProjectDropSide) {
		if (!onReorderProjects || sourceProjectId === targetProjectId) return;
		const source = orderedProjects.find((project) => project.id === sourceProjectId);
		const target = orderedProjects.find((project) => project.id === targetProjectId);
		if (!source || !target || source.kind === "virtual" || isBuiltinOpsProject(target)) return;
		const projectIds = orderedProjects.map((project) => project.id);
		projectIds.splice(projectIds.indexOf(sourceProjectId), 1);
		const targetIndex = projectIds.indexOf(targetProjectId);
		projectIds.splice(side === "after" ? targetIndex + 1 : targetIndex, 0, sourceProjectId);
		void onReorderProjects(projectIds);
	}

	function moveProjectByStep(projectId: string, step: -1 | 1) {
		const index = orderedProjects.findIndex((project) => project.id === projectId);
		const target = orderedProjects[index + step];
		if (!target) return;
		reorderProject(projectId, target.id, step < 0 ? "before" : "after");
	}

	function handleProjectDragOver(event: DragEvent<HTMLElement>, projectId: string) {
		if (!draggedProjectId || draggedProjectId === projectId) return;
		const target = orderedProjects.find((project) => project.id === projectId);
		if (!target || isBuiltinOpsProject(target)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		const rect = event.currentTarget.getBoundingClientRect();
		setProjectDropTarget({
			projectId,
			side: event.clientY > rect.top + rect.height / 2 ? "after" : "before",
		});
	}

	function handleProjectDrop(event: DragEvent<HTMLElement>, projectId: string) {
		if (!draggedProjectId) return;
		event.preventDefault();
		const rect = event.currentTarget.getBoundingClientRect();
		const side: ProjectDropSide = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
		const sourceProjectId = draggedProjectId;
		setDraggedProjectId(null);
		setProjectDropTarget(null);
		reorderProject(sourceProjectId, projectId, side);
	}

	const updateLocalTask = useCallback((task: Task) => {
		setTasksByProject((previous) => {
			const projectId = task.projectId;
			if (!projectId) return previous;
			const next = new Map(previous);
			const current = next.get(projectId) ?? [];
			next.set(projectId, current.some((candidate) => candidate.id === task.id)
				? current.map((candidate) => candidate.id === task.id ? task : candidate)
				: [...current, task]);
			return next;
		});
	}, []);

	const localDispatch = useCallback<Dispatch<AppAction>>((action) => {
		if (action.type === "updateTask" || action.type === "addTask") updateLocalTask(action.task);
		if (action.type === "spawnVariants") action.variants.forEach(updateLocalTask);
		if (action.type === "addAttempts") {
			updateLocalTask(action.updatedSource);
			action.newAttempts.forEach(updateLocalTask);
		}
		if (action.type === "removeTask" && action.projectId) {
			setTasksByProject((previous) => {
				const next = new Map(previous);
				next.set(action.projectId!, (next.get(action.projectId!) ?? []).filter((task) => task.id !== action.taskId));
				return next;
			});
		}
		dispatch(action);
	}, [dispatch, updateLocalTask]);

	function tasksForCell(project: Project, column: WorkspaceColumnId): Task[] {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const tasks = (tasksByProject.get(project.id) ?? [])
			.filter((task) => {
				if (column === "custom") return Boolean(task.customColumnId);
				if (task.customColumnId) return false;
				if (column === "in-progress") return task.status === "in-progress" || task.status === "user-questions";
				return task.status === column;
			})
			.filter((task) => !normalizedQuery || `${project.name} ${getTaskTitle(task)} ${task.description}`.toLocaleLowerCase().includes(normalizedQuery));
		return sortTasksForColumn(tasks, globalSettings.taskSortOrder, column === "custom" ? undefined : column);
	}

	async function moveTask(project: Project, task: Task, targetStatus: TaskStatus) {
		if (task.status === targetStatus && !task.customColumnId) return;
		if (task.status === "todo" && targetStatus !== "todo" && !task.worktreePath) {
			setLaunchModal({ task, project, targetStatus });
			return;
		}
		await moveTaskToStatus({
			task,
			project,
			newStatus: targetStatus,
			dispatch: localDispatch,
			t,
			onOpenTask: () => navigate(getTaskOpenMode() === "fullscreen"
				? { screen: "task", projectId: project.id, taskId: task.id }
				: { screen: "project", projectId: project.id, activeTaskId: task.id }),
			onMovingChange: (moving) => setMovingTaskIds((previous) => {
				const next = new Set(previous);
				if (moving) next.add(task.id); else next.delete(task.id);
				return next;
			}),
		});
	}

	function columnLabel(column: WorkspaceColumnId): string {
		return column === "custom" ? t("workspaceBoard.custom") : t(statusKey(column));
	}

	function isColumnAvailable(project: Project, column: WorkspaceColumnId): boolean {
		if (project.kind === "virtual" && (column === "review-by-ai" || column === "review-by-colleague")) return false;
		if (column === "review-by-colleague" && project.peerReviewEnabled === false) return false;
		return true;
	}

	function visibleTasksForCell(project: Project, column: WorkspaceColumnId, tasks: Task[]): Task[] {
		if (column === "completed") {
			return expandedCompletedProjects.has(project.id)
				? tasks
				: tasks.slice(0, COMPLETED_COLLAPSED_TASK_LIMIT);
		}
		return tasks.slice(0, WORKSPACE_CELL_TASK_LIMIT);
	}

	function renderCellOverflow(project: Project, column: WorkspaceColumnId, tasks: Task[]) {
		if (column !== "completed") {
			if (tasks.length <= WORKSPACE_CELL_TASK_LIMIT) return null;
			return <div className="py-1 text-center text-dense text-fg-muted">{t("kanban.showMore", { count: String(tasks.length - WORKSPACE_CELL_TASK_LIMIT) })}</div>;
		}

		const expanded = expandedCompletedProjects.has(project.id);
		if (tasks.length <= COMPLETED_COLLAPSED_TASK_LIMIT) return null;
		return (
			<button
				type="button"
				onClick={() => setExpandedCompletedProjects((previous) => {
					const next = new Set(previous);
					if (expanded) next.delete(project.id); else next.add(project.id);
					return next;
				})}
				aria-expanded={expanded}
				className="w-full rounded-md py-1 text-center text-dense text-fg-3 transition-[color,background-color] hover:bg-fg/5 hover:text-fg"
			>
				{expanded
					? t("kanban.showLess")
					: t("kanban.showMore", { count: String(tasks.length - COMPLETED_COLLAPSED_TASK_LIMIT) })}
			</button>
		);
	}

	function renderTaskCard(project: Project, task: Task, siblingMap: Map<string, Task[]>) {
		return (
			<TaskCard
				key={`${project.id}:${task.id}`}
				task={task}
				project={project}
				dispatch={localDispatch}
				navigate={navigate}
				agents={agents}
				onLaunchVariants={(candidate, targetStatus) => setLaunchModal({ task: candidate, project, targetStatus })}
				onAddAttempts={(candidate) => setLaunchModal({ task: candidate, project, targetStatus: candidate.status, mode: "addAttempts" })}
				onDragStart={(taskId) => setDragged({ projectId: project.id, taskId, status: task.status })}
				bellCount={bellCounts.get(task.id) ?? 0}
				isMoving={movingTaskIds.has(task.id)}
				onSetMoving={(taskId, moving) => setMovingTaskIds((previous) => {
					const next = new Set(previous);
					if (moving) next.add(taskId); else next.delete(taskId);
					return next;
				})}
				siblingMap={siblingMap}
				onOpenWorkspaceTask={onOpenWorkspaceTask
					? (candidate, candidateProject, trigger) => onOpenWorkspaceTask(candidateProject, candidate, tasksByProject.get(candidateProject.id) ?? [candidate], trigger)
					: undefined}
				compact
			/>
		);
	}

	function renderAddTaskButton(project: Project, column: WorkspaceColumnId) {
		if (column !== "todo") return null;
		return (
			<button
				type="button"
				onClick={() => onOpenCreateTask(project.id)}
				className="mt-1 w-full rounded-lg border border-dashed border-edge px-2 py-2 text-center text-xs font-medium text-fg-3 transition-[color,background-color,border-color,transform] hover:border-accent/30 hover:bg-accent/10 hover:text-accent motion-safe:active:scale-[0.96]"
			>
				{t("kanban.newTask")}
			</button>
		);
	}

	if (loading && tasksByProject.size === 0) {
		return <div className="flex h-full items-center justify-center text-sm text-fg-3">{t("workspaceBoard.loading")}</div>;
	}

	const carouselColumns: CarouselColumn[] = isNarrow ? columns.map((column) => ({
		id: column,
		label: columnLabel(column),
		color: column === "custom" ? statusColors.todo : statusColors[column],
		count: orderedProjects.reduce((sum, project) => sum + tasksForCell(project, column).length, 0),
		element: (
			<div className="h-full w-full overflow-y-auto rounded-xl border border-edge bg-base/30 p-2">
				{orderedProjects.map((project, projectIndex) => {
					const projectTasks = tasksByProject.get(project.id) ?? [];
					const siblingMap = new Map<string, Task[]>();
					for (const task of projectTasks) if (task.groupId) siblingMap.set(task.groupId, [...(siblingMap.get(task.groupId) ?? []), task]);
					const cellTasks = tasksForCell(project, column);
					const available = isColumnAvailable(project, column) || cellTasks.length > 0;
					const cannotReorder = project.kind === "virtual";
					const hasPinnedBuiltin = orderedProjects.length > 0 && isBuiltinOpsProject(orderedProjects[0]);
					const cannotMoveUp = projectIndex === 0 || (hasPinnedBuiltin && projectIndex === 1) || cannotReorder;
					const cannotMoveDown = projectIndex === orderedProjects.length - 1 || cannotReorder;
					return (
						<section key={project.id} className="mb-3 rounded-lg border border-edge bg-raised/30 p-2" aria-label={project.name}>
							<div className="mb-2 flex items-center gap-1">
								<button onClick={() => navigate({ screen: "project", projectId: project.id })} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-fg hover:text-accent">{project.name}</button>
								<button
									type="button"
									onClick={() => moveProjectByStep(project.id, -1)}
									disabled={!onReorderProjects || cannotMoveUp}
									aria-label={t("dashboard.moveProjectUp")}
									className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-3"
								>
									<span aria-hidden="true" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\uF062"}</span>
								</button>
								<button
									type="button"
									onClick={() => moveProjectByStep(project.id, 1)}
									disabled={!onReorderProjects || cannotMoveDown}
									aria-label={t("dashboard.moveProjectDown")}
									className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-3"
								>
									<span aria-hidden="true" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\uF063"}</span>
								</button>
							</div>
							<div className="space-y-2">
								{cellTasks.length > 0
									? visibleTasksForCell(project, column, cellTasks).map((task) => renderTaskCard(project, task, siblingMap))
									: <div className="py-3 text-center text-xs text-fg-muted">{available ? t("kanban.noTasks") : t("workspaceBoard.notApplicable")}</div>}
								{renderCellOverflow(project, column, cellTasks)}
								{renderAddTaskButton(project, column)}
							</div>
						</section>
					);
				})}
			</div>
		),
	})) : [];

	return (
		<div className="flex h-full min-h-0 flex-col" data-help-id="dashboard.workspace-board" tabIndex={-1}>
		{loadErrors.length > 0 && <div className="flex justify-end border-b border-edge px-3 py-2"><button onClick={load} className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">{t("workspaceBoard.retry")}</button></div>}
		{isNarrow ? (
			<MobileBoardCarousel columns={carouselColumns} initialColumnId={carouselColumns.find((column) => column.id === "in-progress" && column.count > 0)?.id ?? "review-by-user"} />
		) : <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
			<div className="sticky top-0 z-20 grid border-b border-edge bg-base/95 backdrop-blur" style={{ gridTemplateColumns: `10rem repeat(${columns.length}, minmax(0, 1fr))` }}>
				<div className="px-3 py-3 text-dense font-bold uppercase tracking-[0.08em] text-fg-3">{t("workspaceBoard.projects")}</div>
				{columns.map((column) => {
					const color = column === "custom" ? statusColors.todo : statusColors[column];
					const count = orderedProjects.reduce((sum, project) => sum + tasksForCell(project, column).length, 0);
					return <div key={column} className="flex min-w-0 items-center gap-1.5 border-l border-edge px-2 py-3"><span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} /><span className="truncate text-dense font-bold uppercase tracking-[0.04em] text-fg">{columnLabel(column)}</span>{count > 0 && <span className="ml-auto rounded-full bg-fg/8 px-1.5 text-dense text-fg-3">{count}</span>}</div>;
				})}
			</div>
			{orderedProjects.map((project, projectIndex) => {
				const projectTasks = tasksByProject.get(project.id) ?? [];
				const siblingMap = new Map<string, Task[]>();
				for (const task of projectTasks) if (task.groupId) siblingMap.set(task.groupId, [...(siblingMap.get(task.groupId) ?? []), task]);
				const cannotReorder = project.kind === "virtual";
				const dragEnabled = !!onReorderProjects && !cannotReorder;
				const isDragged = draggedProjectId === project.id;
				const showDropBefore = projectDropTarget?.projectId === project.id && projectDropTarget.side === "before";
				const showDropAfter = projectDropTarget?.projectId === project.id && projectDropTarget.side === "after";
				const hasPinnedBuiltin = orderedProjects.length > 0 && isBuiltinOpsProject(orderedProjects[0]);
				const cannotMoveUp = projectIndex === 0 || (hasPinnedBuiltin && projectIndex === 1) || cannotReorder;
				const cannotMoveDown = projectIndex === orderedProjects.length - 1 || cannotReorder;
				return (
					<section
						key={project.id}
						className={`relative grid min-h-36 border-b border-edge transition-opacity ${isDragged ? "opacity-60" : ""}`}
						style={{ gridTemplateColumns: `10rem repeat(${columns.length}, minmax(0, 1fr))` }}
						aria-label={project.name}
						onDragOver={(event) => handleProjectDragOver(event, project.id)}
						onDragLeave={() => setProjectDropTarget((current) => current?.projectId === project.id ? null : current)}
						onDrop={(event) => handleProjectDrop(event, project.id)}
					>
						{showDropBefore && <div className="pointer-events-none absolute inset-x-2 top-0 z-20 h-0.5 rounded-full bg-accent" />}
						{showDropAfter && <div className="pointer-events-none absolute inset-x-2 bottom-0 z-20 h-0.5 rounded-full bg-accent" />}
						<div className="sticky left-0 z-10 bg-base/90 px-3 py-3">
							<div className="flex items-center gap-1">
								<span
									role="presentation"
									draggable={dragEnabled}
									onDragStart={(event) => {
										if (!dragEnabled) return;
										setDraggedProjectId(project.id);
										event.dataTransfer.setData("text/plain", `project:${project.id}`);
										event.dataTransfer.effectAllowed = "move";
									}}
									onDragEnd={() => {
										setDraggedProjectId(null);
										setProjectDropTarget(null);
									}}
									title={dragEnabled ? t("dashboard.reorderProject") : undefined}
									className={`-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors ${dragEnabled ? "cursor-grab hover:bg-elevated hover:text-fg active:cursor-grabbing" : "cursor-default opacity-40"}`}
								>
									<span aria-hidden="true" className="text-base leading-none" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\u{F01DB}"}</span>
								</span>
								<button onClick={() => navigate({ screen: "project", projectId: project.id })} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-fg hover:text-accent">{project.name}</button>
							</div>
							<div className="mt-1 text-dense text-fg-muted">{t("workspaceBoard.taskCount", { count: String(projectTasks.length) })}</div>
							<div className="mt-1 flex items-center gap-0.5">
								<button type="button" onClick={() => moveProjectByStep(project.id, -1)} disabled={!onReorderProjects || cannotMoveUp} title={t("dashboard.moveProjectUp")} aria-label={t("dashboard.moveProjectUp")} className="rounded p-1 text-fg-3 transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-3"><span aria-hidden="true" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\uF062"}</span></button>
								<button type="button" onClick={() => moveProjectByStep(project.id, 1)} disabled={!onReorderProjects || cannotMoveDown} title={t("dashboard.moveProjectDown")} aria-label={t("dashboard.moveProjectDown")} className="rounded p-1 text-fg-3 transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-3"><span aria-hidden="true" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\uF063"}</span></button>
							</div>
							<button onClick={() => navigate({ screen: "project", projectId: project.id })} className="mt-3 text-xs font-medium text-accent hover:underline">{t("workspaceBoard.openProject")}</button>
						</div>
						{columns.map((column) => {
							const cellTasks = tasksForCell(project, column);
							const targetStatus = column === "custom" ? null : column;
							const available = isColumnAvailable(project, column) || cellTasks.length > 0;
							const acceptsDrop = available && targetStatus && dragged?.projectId === project.id && getAllowedTransitions(dragged.status).includes(targetStatus);
							return (
								<div
									key={column}
									className={`min-w-0 border-l border-edge p-1.5 ${acceptsDrop ? "bg-accent/5" : ""}`}
									aria-label={acceptsDrop ? t("workspaceBoard.dropHere", { status: columnLabel(column), project: project.name }) : undefined}
									onDragOver={acceptsDrop ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } : undefined}
									onDrop={acceptsDrop ? (event) => {
										event.preventDefault();
										const task = projectTasks.find((candidate) => candidate.id === dragged?.taskId);
										setDragged(null);
										if (task && targetStatus) moveTask(project, task, targetStatus);
									} : undefined}
								>
									{acceptsDrop && <div className="mb-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-1 text-center text-dense font-semibold text-accent">{t("workspaceBoard.dropHereShort")}</div>}
									<div className="space-y-1.5">
										{visibleTasksForCell(project, column, cellTasks).map((task) => renderTaskCard(project, task, siblingMap))}
										{!available && <div className="py-5 text-center text-dense text-fg-muted">{t("workspaceBoard.notApplicable")}</div>}
										{renderCellOverflow(project, column, cellTasks)}
										{renderAddTaskButton(project, column)}
									</div>
								</div>
							);
						})}
					</section>
				);
			})}
		</div>}
		{launchModal && <LaunchVariantsModal task={launchModal.task} project={launchModal.project} targetStatus={launchModal.targetStatus} agents={agents} globalSettings={globalSettings} dispatch={localDispatch} onClose={() => setLaunchModal(null)} mode={launchModal.mode} onGlobalSettingsChange={setGlobalSettings} />}
		</div>
	);
}

export default WorkspaceBoard;
