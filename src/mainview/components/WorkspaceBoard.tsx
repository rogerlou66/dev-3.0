import { useCallback, useEffect, useMemo, useState, type Dispatch, type DragEvent } from "react";
import type { CodingAgent, GlobalSettings, Project, Task, TaskStatus } from "../../shared/types";
import { ACTIVE_STATUSES, getAllowedTransitions, getTaskTitle, isBuiltinOpsProject, orderProjectsForDisplay, taskSortRank } from "../../shared/types";
import type { AppAction, Route } from "../state";
import { getTaskOpenMode } from "../state";
import { useT, statusKey } from "../i18n";
import { api } from "../rpc";
import { toast } from "../toast";
import { useStatusColors } from "../hooks/useStatusColors";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { moveTaskToStatus } from "../utils/moveTaskToStatus";
import { sortTasksForColumn } from "./sortTasks";
import { canBlockTask, effectiveTaskColumn, isTaskBlocked, type TaskBoardColumn } from "../../shared/task-blocking";
import { setTaskBlocked } from "../utils/setTaskBlocked";
import { matchesTaskQuery } from "../utils/taskSearch";
import { isAttentionTask } from "../utils/taskFacets";
import HelpSpot from "./HelpSpot";
import TaskCard from "./TaskCard";
import PriorityBadge from "./PriorityBadge";
import LaunchVariantsModal from "./LaunchVariantsModal";
import MobileBoardCarousel, { CAROUSEL_MAX_WIDTH, type CarouselColumn } from "./MobileBoardCarousel";

type WorkspaceColumnId = TaskBoardColumn;
type WorkspaceTasksResult = { projectId: string; tasks: Task[]; error?: string };

interface WorkspaceBoardProps {
	projects: Project[];
	query: string;
	dispatch: Dispatch<AppAction>;
	navigate: (route: Route) => void;
	bellCounts: Map<string, number>;
	onOpenCreateTask: (projectId: string) => void;
	onOpenAddProject?: () => void;
	onOpenWorkspaceTask?: (project: Project, task: Task, tasks: Task[], trigger: HTMLElement | null) => void;
	onReorderProjects?: (projectIds: string[]) => void | Promise<void>;
}

const BASE_COLUMNS: WorkspaceColumnId[] = ["todo", "in-progress", "review-by-user", "blocked", "review-by-colleague", "completed"];
const WORKSPACE_CELL_TASK_LIMIT = 15;
const COMPLETED_COLLAPSED_TASK_LIMIT = 2;
type ProjectDropSide = "before" | "after";

function WorkspaceBoard({ projects, query, dispatch, navigate, bellCounts, onOpenCreateTask, onOpenAddProject, onOpenWorkspaceTask, onReorderProjects }: WorkspaceBoardProps) {
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
		if (allTasks.some((task) => effectiveTaskColumn(task) === "review-by-ai")) next.splice(2, 0, "review-by-ai");
		if (allTasks.some((task) => effectiveTaskColumn(task) === "custom")) {
			const completedIndex = next.indexOf("completed");
			next.splice(completedIndex, 0, "custom");
		}
		return next;
	}, [allTasks]);
	const desktopColumns = useMemo(() => columns.filter((column) => column !== "completed"), [columns]);
	const projectById = useMemo(() => new Map(orderedProjects.map((project) => [project.id, project])), [orderedProjects]);

	function matchesWorkspaceQuery(project: Project, task: Task): boolean {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		return !normalizedQuery || matchesTaskQuery({ ...task, description: `${project.name} ${task.description}` }, normalizedQuery, {
			labelNames: (project.labels ?? []).filter((label) => task.labelIds?.includes(label.id)).map((label) => label.name),
			agentName: agents.find((agent) => agent.id === task.agentId)?.name ?? null,
			statusValues: [task.status, t(statusKey(task.status)), ...(task.customColumnId ? (project.customColumns ?? []).filter((column) => column.id === task.customColumnId).map((column) => column.name) : [])],
			priorityValue: task.priority?.toLowerCase() ?? "p3", hasPort: false, isAttention: isAttentionTask(task), spaceNames: null,
		});
	}

	const inboxItems = useMemo(() => {
		const items = allTasks
			.filter((task) => !isTaskBlocked(task) && (task.status === "user-questions" || task.status === "review-by-user"))
			.map((task) => ({ task, project: projectById.get(task.projectId) }))
			.filter((entry): entry is { task: Task; project: Project } => !!entry.project)
			.filter(({ task, project }) => matchesWorkspaceQuery(project, task));
		return items.sort((a, b) => {
			const rankDelta = taskSortRank(a.task) - taskSortRank(b.task);
			if (rankDelta !== 0) return rankDelta;
			const aTime = Date.parse(a.task.movedAt ?? a.task.updatedAt ?? a.task.createdAt);
			const bTime = Date.parse(b.task.movedAt ?? b.task.updatedAt ?? b.task.createdAt);
			return globalSettings.taskSortOrder === "newest-first" ? bTime - aTime : aTime - bTime;
		});
	}, [allTasks, globalSettings.taskSortOrder, projectById, query]);

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
		const tasks = (tasksByProject.get(project.id) ?? [])
			.filter((task) => {
				const effective = effectiveTaskColumn(task);
				if (column === "in-progress") return effective === "in-progress" || effective === "user-questions";
				return effective === column;
			})
			.filter((task) => matchesWorkspaceQuery(project, task));
		return sortTasksForColumn(tasks, globalSettings.taskSortOrder, column === "custom" || column === "blocked" ? undefined : column);
	}

	async function moveTask(project: Project, task: Task, targetStatus: TaskStatus) {
		if (task.status === targetStatus && !task.customColumnId && !isTaskBlocked(task)) return;
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

	function openInboxTask(project: Project, task: Task, trigger: HTMLElement | null) {
		if (onOpenWorkspaceTask && ACTIVE_STATUSES.includes(task.status)) {
			onOpenWorkspaceTask(project, task, tasksByProject.get(project.id) ?? [task], trigger);
			return;
		}
		navigate({ screen: "task", projectId: project.id, taskId: task.id });
	}

	function inboxAgentLabel(task: Task): string {
		const agent = task.agentId ? agents.find((candidate) => candidate.id === task.agentId) : null;
		const config = agent && task.configId
			? agent.configurations.find((candidate) => candidate.id === task.configId)
			: agent?.configurations.find((candidate) => candidate.id === agent.defaultConfigId) ?? agent?.configurations[0];
		if (config) return config.model ? `${config.name} · ${config.model}` : config.name;
		return agent?.name ?? "—";
	}

	function inboxAge(task: Task): string {
		const enteredAt = Date.parse(task.movedAt ?? task.updatedAt ?? task.createdAt);
		const elapsed = Math.max(0, Date.now() - enteredAt);
		if (elapsed < 60_000) return t("activity.justNow");
		if (elapsed < 3_600_000) return t("activity.minutesAgo", { count: String(Math.floor(elapsed / 60_000)) });
		if (elapsed < 86_400_000) return t("activity.hoursAgo", { count: String(Math.floor(elapsed / 3_600_000)) });
		return t("activity.daysAgo", { count: String(Math.floor(elapsed / 86_400_000)) });
	}

	function columnLabel(column: WorkspaceColumnId): string {
		if (column === "blocked") return t("task.blocked");
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

	function renderInbox() {
		return (
			<section className="flex h-32 flex-shrink-0 overflow-hidden border-b border-edge bg-gradient-to-b from-raised/80 to-base/40" aria-label={t("workspaceBoard.inbox")}>
				<div className="flex w-10 flex-shrink-0 flex-col items-center justify-center gap-2 border-r border-edge bg-base/25" title={t("workspaceBoard.inboxDescription")}>
					<span className={`h-1.5 w-1.5 rounded-full bg-[#FFA353] ${inboxItems.length > 0 ? "motion-safe:animate-pulse" : "opacity-40"}`} />
					<div className="flex h-12 w-full items-center justify-center overflow-visible">
						<h2 data-testid="workspace-inbox-rail" className="-rotate-90 whitespace-nowrap text-dense font-bold uppercase tracking-[0.16em] text-fg">{t("workspaceBoard.inbox")}</h2>
					</div>
					<span className="rounded bg-[#FFA353] px-1.5 py-px font-mono text-nano font-bold" style={{ color: "#2b1402" }}>{inboxItems.length}</span>
					<span className="sr-only">{t("workspaceBoard.inboxDescription")}</span>
				</div>
				<div className="min-w-0 flex-1 overflow-x-auto p-2">
				{inboxItems.length === 0 ? (
					<div className="flex h-full items-center rounded-lg border border-dashed border-edge px-3 text-xs text-fg-muted">{t("workspaceBoard.inboxEmpty")}</div>
				) : (
					<div className="flex h-full gap-2">
						{inboxItems.map(({ task, project }) => {
							const isQuestion = task.status === "user-questions";
							const statusColor = statusColors[task.status];
							const busy = movingTaskIds.has(task.id);
							return (
								<article key={`inbox:${project.id}:${task.id}`} className="group/inbox flex w-[14.875rem] flex-none flex-col gap-1 rounded-lg border border-edge-active bg-raised/90 px-2.5 py-2 shadow-sm shadow-black/20">
									<div className="flex min-w-0 items-center gap-1.5">
										<PriorityBadge priority={task.priority} />
										<span className="flex-shrink-0 font-mono text-nano text-fg-muted">#{task.seq}</span>
										<span className="min-w-0 flex-1 truncate text-nano font-medium text-fg-3">{project.name}</span>
										<span className="flex-shrink-0 text-nano font-semibold" style={{ color: statusColor }}>{isQuestion ? t("workspaceBoard.question") : t("workspaceBoard.review")}</span>
										<span className="flex-shrink-0 font-mono text-nano text-fg-muted">{inboxAge(task)}</span>
									</div>
									<button type="button" onClick={(event) => openInboxTask(project, task, event.currentTarget)} className="flex min-w-0 items-center gap-2 rounded text-left focus-visible:ring-1 focus-visible:ring-accent/70">
										<span className="h-5 w-0.5 flex-shrink-0 rounded-full" style={{ background: statusColor }} />
										<span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border font-mono text-nano" style={{ borderColor: statusColor, color: statusColor }}>{isQuestion ? "?" : "!"}</span>
										<span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg streamer-private">{getTaskTitle(task)}</span>
									</button>
									<div className="truncate font-mono text-nano text-fg-muted">{inboxAgentLabel(task)}</div>
									<div className="mt-0.5 flex items-center gap-1">
										{isQuestion ? (
											<>
												<button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); openInboxTask(project, task, event.currentTarget); }} className="rounded-md bg-[#FFA353] px-2 py-1 text-dense font-bold transition-[filter,transform] hover:brightness-110 motion-safe:active:scale-[0.96]" style={{ color: "#2b1402" }}>{t("workspaceBoard.answer")}</button>
												<button type="button" onClick={() => navigate({ screen: "task", projectId: project.id, taskId: task.id })} className="rounded-md bg-fg/8 px-2 py-1 text-dense font-medium text-fg-2 hover:bg-fg/12">{t("workspaceBoard.open")}</button>
											</>
										) : (
											<>
												{isColumnAvailable(project, "review-by-colleague") && <button type="button" disabled={busy} onClick={() => void moveTask(project, task, "review-by-colleague")} className="rounded-md bg-[rgb(196_165_255_/_0.14)] px-2 py-1 text-dense font-medium hover:bg-[rgb(196_165_255_/_0.22)]" style={{ color: "#C4A5FF" }}>{t("status.reviewByColleague")}</button>}
												<button type="button" disabled={busy} onClick={() => void moveTask(project, task, "completed")} className="rounded-md bg-[#3CF3B0] px-2 py-1 text-dense font-bold hover:brightness-110" style={{ color: "#04281c" }}>{t("status.completed")}</button>
											</>
										)}
										<button type="button" disabled={busy} onClick={() => void moveTask(project, task, "cancelled")} className="rounded-md bg-danger/10 px-2 py-1 text-dense font-medium text-danger hover:bg-danger/15">{t("task.cancel")}</button>
									</div>
								</article>
							);
						})}
					</div>
				)}
				</div>
			</section>
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
				<div className="mb-2 flex min-w-0 items-center gap-2 px-1">
					<span className="h-2 w-2 shrink-0 rounded-full" style={{ background: column === "custom" ? statusColors.todo : statusColors[column] }} />
					<h2 className="min-w-0 truncate text-sm font-semibold text-fg">{columnLabel(column)}</h2>
					{column === "blocked" && <HelpSpot topicId="board.column.blocked" />}
				</div>
				{orderedProjects.map((project) => {
					const projectTasks = tasksByProject.get(project.id) ?? [];
					const siblingMap = new Map<string, Task[]>();
					for (const task of projectTasks) if (task.groupId) siblingMap.set(task.groupId, [...(siblingMap.get(task.groupId) ?? []), task]);
					const cellTasks = tasksForCell(project, column);
					const available = isColumnAvailable(project, column) || cellTasks.length > 0;
					return (
						<section key={project.id} className="mb-3 rounded-lg border border-edge bg-raised/30 p-2" aria-label={project.name}>
							<button onClick={() => navigate({ screen: "project", projectId: project.id })} className="mb-2 block w-full truncate text-left text-sm font-semibold text-fg hover:text-accent">{project.name}</button>
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
	const desktopGridStyle = { gridTemplateColumns: `10.5rem repeat(${desktopColumns.length}, minmax(12.5rem, 1fr)) 4.75rem` };
	const desktopGridMinWidth = `${10.5 + desktopColumns.length * 12.5 + 4.75}rem`;

	return (
		<div className="flex h-full min-h-0 flex-col" data-help-id="dashboard.workspace-board" tabIndex={-1}>
		{loadErrors.length > 0 && <div className="flex justify-end border-b border-edge px-3 py-2"><button onClick={load} className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">{t("workspaceBoard.retry")}</button></div>}
		{isNarrow ? (
			<MobileBoardCarousel columns={carouselColumns} initialColumnId={carouselColumns.find((column) => column.id === "in-progress" && column.count > 0)?.id ?? "review-by-user"} />
		) : <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
			{renderInbox()}
			<div data-testid="workspace-kanban-scroll" className="min-h-0 flex-1 overflow-auto">
			<div style={{ minWidth: desktopGridMinWidth }}>
				<div className="sticky top-0 z-20 grid h-9 border-b border-edge bg-base/95 backdrop-blur" style={desktopGridStyle}>
					<div className="sticky left-0 z-10 flex items-center bg-base/95 px-3 text-dense font-bold uppercase tracking-[0.12em] text-fg-3">{t("workspaceBoard.projects")}</div>
					{desktopColumns.map((column) => {
					const color = column === "custom" ? statusColors.todo : statusColors[column];
					const count = orderedProjects.reduce((sum, project) => sum + tasksForCell(project, column).length, 0);
					return <div key={column} className="flex min-w-0 items-center gap-1.5 border-l border-edge px-2"><span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: color }} /><span className="truncate text-dense font-bold uppercase tracking-[0.08em] text-fg-2">{columnLabel(column)}</span>{column === "blocked" && <HelpSpot topicId="board.column.blocked" />}{count > 0 && <span className="ml-auto font-mono text-nano text-fg-muted">{count}</span>}</div>;
					})}
					<div className="flex items-center gap-1.5 border-l border-edge px-2 text-dense font-bold uppercase tracking-[0.08em] text-fg-muted">{t("workspaceBoard.done")}</div>
				</div>
				{orderedProjects.map((project) => {
				const projectTasks = tasksByProject.get(project.id) ?? [];
				const siblingMap = new Map<string, Task[]>();
				for (const task of projectTasks) if (task.groupId) siblingMap.set(task.groupId, [...(siblingMap.get(task.groupId) ?? []), task]);
				const completedTasks = tasksForCell(project, "completed");
				const displayTaskCount = desktopColumns.reduce((sum, column) => sum + tasksForCell(project, column).length, 0);
				const collapsed = displayTaskCount === 0;
				const completedExpanded = expandedCompletedProjects.has(project.id);
				const cannotReorder = project.kind === "virtual";
				const dragEnabled = !!onReorderProjects && !cannotReorder;
				const isDragged = draggedProjectId === project.id;
				const showDropBefore = projectDropTarget?.projectId === project.id && projectDropTarget.side === "before";
				const showDropAfter = projectDropTarget?.projectId === project.id && projectDropTarget.side === "after";
				return (
					<section
						key={project.id}
						className={`relative border-b border-edge transition-opacity ${isDragged ? "opacity-60" : ""}`}
						aria-label={project.name}
						onDragOver={(event) => handleProjectDragOver(event, project.id)}
						onDragLeave={() => setProjectDropTarget((current) => current?.projectId === project.id ? null : current)}
						onDrop={(event) => handleProjectDrop(event, project.id)}
					>
						{showDropBefore && <div className="pointer-events-none absolute inset-x-2 top-0 z-20 h-0.5 rounded-full bg-accent" />}
						{showDropAfter && <div className="pointer-events-none absolute inset-x-2 bottom-0 z-20 h-0.5 rounded-full bg-accent" />}
						{collapsed ? (
							<div className="flex h-9 items-center gap-2 bg-base/60 px-3" style={{ minWidth: desktopGridMinWidth }}>
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
									className={`-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-3 transition-colors ${dragEnabled ? "cursor-grab hover:bg-elevated hover:text-fg active:cursor-grabbing" : "cursor-default opacity-40"}`}
								>
									<span aria-hidden="true" className="text-base leading-none" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\u{F01DB}"}</span>
								</span>
								<button onClick={() => navigate({ screen: "project", projectId: project.id })} className="max-w-64 truncate text-left text-xs font-semibold text-fg-3 hover:text-accent">{project.name}</button>
								<span className="text-dense text-fg-muted">{t("workspaceBoard.noActiveSummary", { count: String(completedTasks.length) })}</span>
								<button type="button" onClick={() => onOpenCreateTask(project.id)} className="ml-auto rounded px-2 py-1 text-dense font-medium text-fg-3 hover:bg-accent/10 hover:text-accent">{t("kanban.newTask")}</button>
								{completedTasks.length > 0 && <button type="button" onClick={() => setExpandedCompletedProjects((previous) => { const next = new Set(previous); if (completedExpanded) next.delete(project.id); else next.add(project.id); return next; })} aria-expanded={completedExpanded} className="rounded px-2 py-1 font-mono text-dense font-semibold text-success hover:bg-success/10">✓ {completedTasks.length}</button>}
							</div>
						) : (
						<div className="grid" style={desktopGridStyle}>
							<div className="sticky left-0 z-10 bg-base/90 px-3 py-2">
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
										onDragEnd={() => { setDraggedProjectId(null); setProjectDropTarget(null); }}
										title={dragEnabled ? t("dashboard.reorderProject") : undefined}
										className={`-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-3 transition-colors ${dragEnabled ? "cursor-grab hover:bg-elevated hover:text-fg active:cursor-grabbing" : "cursor-default opacity-40"}`}
									>
										<span aria-hidden="true" className="text-base leading-none" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\u{F01DB}"}</span>
									</span>
									<button onClick={() => navigate({ screen: "project", projectId: project.id })} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-fg hover:text-accent">{project.name}</button>
								</div>
								<div className="mt-0.5 font-mono text-nano text-fg-muted">{t("workspaceBoard.taskCount", { count: String(projectTasks.length) })}</div>
							</div>
						{desktopColumns.map((column) => {
							const cellTasks = tasksForCell(project, column);
							const targetStatus = column === "custom" || column === "blocked" ? null : column;
							const available = isColumnAvailable(project, column) || cellTasks.length > 0;
							const draggedTask = dragged?.projectId === project.id ? projectTasks.find((task) => task.id === dragged.taskId) : undefined;
							const acceptsDrop = available && draggedTask && (column === "blocked"
								? canBlockTask(draggedTask) && !isTaskBlocked(draggedTask)
								: targetStatus && (getAllowedTransitions(draggedTask.status).includes(targetStatus) || (isTaskBlocked(draggedTask) && draggedTask.status === targetStatus)));
							return (
								<div
									key={column}
									data-testid={`workspace-cell-${project.id}-${column}`}
									className={`min-w-0 border-l border-edge p-1 ${acceptsDrop ? "bg-accent/5" : ""}`}
									aria-label={acceptsDrop ? t("workspaceBoard.dropHere", { status: columnLabel(column), project: project.name }) : undefined}
									onDragOver={acceptsDrop ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } : undefined}
									onDrop={acceptsDrop ? (event) => {
										event.preventDefault();
										const task = projectTasks.find((candidate) => candidate.id === dragged?.taskId);
										setDragged(null);
										if (task && column === "blocked") void setTaskBlocked({ task, blocked: true, dispatch: localDispatch, t });
										else if (task && targetStatus) void moveTask(project, task, targetStatus);
									} : undefined}
								>
									{acceptsDrop && <div className="mb-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-1 text-center text-dense font-semibold text-accent">{t("workspaceBoard.dropHereShort")}</div>}
									<div className="space-y-1">
										{visibleTasksForCell(project, column, cellTasks).map((task) => renderTaskCard(project, task, siblingMap))}
										{!available && <div className="py-5 text-center text-dense text-fg-muted">{t("workspaceBoard.notApplicable")}</div>}
										{renderCellOverflow(project, column, cellTasks)}
										{renderAddTaskButton(project, column)}
									</div>
								</div>
							);
						})}
							<div className="flex items-center justify-center border-l border-edge px-1">
								<button type="button" disabled={completedTasks.length === 0} onClick={() => setExpandedCompletedProjects((previous) => { const next = new Set(previous); if (completedExpanded) next.delete(project.id); else next.add(project.id); return next; })} aria-expanded={completedExpanded} className="rounded px-2 py-1 font-mono text-dense font-semibold text-success transition-colors hover:bg-success/10 disabled:text-fg-muted disabled:hover:bg-transparent">✓ {completedTasks.length}</button>
							</div>
						</div>
						)}
						{completedExpanded && completedTasks.length > 0 && (
							<div className="border-t border-edge bg-success/5 px-3 py-2">
								<div className="mb-2 flex items-center gap-2"><span className="text-dense font-bold uppercase tracking-[0.08em] text-success">{t("status.completed")}</span><span className="font-mono text-nano text-fg-muted">{completedTasks.length}</span><button type="button" onClick={() => setExpandedCompletedProjects((previous) => { const next = new Set(previous); next.delete(project.id); return next; })} className="ml-auto rounded px-2 py-1 text-dense text-fg-3 hover:bg-fg/8 hover:text-fg">{t("kanban.showLess")}</button></div>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1">{completedTasks.map((task) => renderTaskCard(project, task, siblingMap))}</div>
							</div>
						)}
					</section>
				);
				})}
				{onOpenAddProject && <button type="button" onClick={onOpenAddProject} className="flex h-9 w-full items-center px-3 text-xs font-medium text-fg-muted transition-colors hover:bg-accent/5 hover:text-accent">+ {t("dashboard.addProject")}</button>}
			</div>
			</div>
		</div>}
		{launchModal && <LaunchVariantsModal task={launchModal.task} project={launchModal.project} targetStatus={launchModal.targetStatus} agents={agents} globalSettings={globalSettings} dispatch={localDispatch} onClose={() => setLaunchModal(null)} mode={launchModal.mode} onGlobalSettingsChange={setGlobalSettings} />}
		</div>
	);
}

export default WorkspaceBoard;
