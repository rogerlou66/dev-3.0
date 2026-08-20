import { useState, useRef, useEffect, type Dispatch } from "react";
import type { CodingAgent, PortInfo, Project, ResourceUsage, Task, TaskPRBadgeInfo, TaskStatus, TipState } from "../../shared/types";
import { hexToRgb, getAllowedTransitions } from "../../shared/types";
import type { AppAction, Route } from "../state";
import { useT } from "../i18n";
import { useStatusColors, useStatusColorsInk } from "../hooks/useStatusColors";
import TaskCard from "./TaskCard";
import TipCard from "./TipCard";
import HelpSpot from "./HelpSpot";
import { statusHelpTopicId } from "../help";
import type { Tip } from "../tips";

const COLUMN_TASK_LIMIT = 15;

// Module-level variable: set synchronously on dragstart, cleared on dragend.
// Avoids relying on dataTransfer.types which may not include custom MIME types in WKWebView.
let _activeDragColumnId: string | null = null;

interface KanbanColumnProps {
	status: TaskStatus;
	label: string;
	description?: string;
	tasks: Task[];
	project: Project;
	dispatch: Dispatch<AppAction>;
	navigate: (route: Route) => void;
	onAddTask: () => void;
	agents: CodingAgent[];
	onLaunchVariants: (task: Task, targetStatus: TaskStatus) => void;
	onAddAttempts: (task: Task) => void;
	onTaskDrop: (taskId: string, targetStatus: TaskStatus) => void;
	onTaskDropToCustomColumn?: (taskId: string, customColumnId: string) => void;
	dragFromStatus: TaskStatus | null;
	dragFromCustomColumnId?: string | null;
	/** The card being dragged is an unfinished draft: only To Do may accept it. */
	dragFromDraft?: boolean;
	onDragStart: (taskId: string) => void;
	bellCounts: Map<string, number>;
	bellReasons?: Map<string, string[]>;
	taskPorts: Map<string, PortInfo[]>;
	taskResourceUsage?: Map<string, ResourceUsage>;
	activeTaskId?: string;
	movingTaskIds: Set<string>;
	onSetMoving: (taskId: string, isMoving: boolean) => void;
	siblingMap: Map<string, Task[]>;
	// Custom column support
	isCustomColumn?: boolean;
	customColumnId?: string;
	colorOverride?: string;
	isDraggedColumn?: boolean;
	onColumnDragStart?: () => void;
	onColumnDragEnd?: () => void;
	// Column reorder drop target (left half = "before", right half = "after")
	onColumnDrop?: (side: "before" | "after") => void;
	// PR numbers for task cards
	taskPrMap?: Map<string, TaskPRBadgeInfo>;
	onOpenUnresolvedComments?: (task: Task) => void;
	/** Reopens the New Task popup on a draft card. */
	onEditDraft?: (task: Task) => void;
	// Feature discovery tip
	tip?: Tip | null;
	tipState?: TipState;
	onTipChanged?: (next: TipState) => void;
	// Rename support for built-in columns
	onRenameColumn?: (newName: string | null) => void;
	// Freshly created board columns open directly in rename mode so the user can
	// name them without leaving the board (issue #222).
	autoStartEditing?: boolean;
	onAutoEditConsumed?: () => void;
}

function KanbanColumn({
	status,
	label,
	description,
	tasks,
	project,
	dispatch,
	navigate,
	onAddTask,
	agents,
	onLaunchVariants,
	onAddAttempts,
	onTaskDrop,
	onTaskDropToCustomColumn,
	dragFromStatus,
	dragFromCustomColumnId,
	dragFromDraft = false,
	onDragStart,
	bellCounts,
	bellReasons,
	taskPorts,
	taskResourceUsage,
	activeTaskId,
	movingTaskIds,
	onSetMoving,
	siblingMap,
	taskPrMap,
	onOpenUnresolvedComments,
	onEditDraft,
	isCustomColumn,
	customColumnId,
	colorOverride,
	isDraggedColumn,
	onColumnDragStart,
	onColumnDragEnd,
	onColumnDrop,
	tip,
	tipState,
	onTipChanged,
	onRenameColumn,
	autoStartEditing,
	onAutoEditConsumed,
}: KanbanColumnProps) {
	const t = useT();
	const statusColors = useStatusColors();
	// ink = text-safe variant of the status colour (lighter themes need a
	// darker shade to clear APCA |Lc| ≥ 60 on the glass column header).
	const statusColorsInk = useStatusColorsInk();
	const color = colorOverride ?? statusColors[status];
	const inkColor = colorOverride ?? statusColorsInk[status];
	const [dragOver, setDragOver] = useState(false);
	const [columnDragSide, setColumnDragSide] = useState<"before" | "after" | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [editing, setEditing] = useState(false);
	const [editValue, setEditValue] = useState("");
	// A card clipped by the scroll edge sits flush against the pinned footer (tip
	// card / + New Task) and reads as the footer lying on top of it.
	const [listClipped, setListClipped] = useState(false);
	const renameInputRef = useRef<HTMLInputElement>(null);
	const taskListRef = useRef<HTMLDivElement>(null);

	// Auto-collapse when column identity changes (e.g. project switch)
	const columnKey = `${status}:${customColumnId ?? ""}`;
	useEffect(() => {
		setExpanded(false);
	}, [columnKey]);


	function syncListClipped() {
		const el = taskListRef.current;
		if (!el) return;
		setListClipped(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
	}


	function startEditing() {
		if (!onRenameColumn) return;
		setEditValue(label);
		setEditing(true);
		// Focus input on next tick
		setTimeout(() => renameInputRef.current?.select(), 0);
	}

	function commitRename() {
		setEditing(false);
		if (!onRenameColumn) return;
		const trimmed = editValue.trim();
		// If empty or unchanged from the current label, reset (pass null to clear custom name)
		if (!trimmed || trimmed === label) {
			return;
		}
		onRenameColumn(trimmed);
	}

	// A board-created custom column mounts straight into rename mode (issue #222)
	// so the user names it in place. Runs once on mount; the parent clears the
	// trigger via onAutoEditConsumed so it never re-fires on later re-renders.
	useEffect(() => {
		if (!autoStartEditing) return;
		startEditing();
		onAutoEditConsumed?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// A draft may only ever be dropped back into To Do — the mouse must not become
	// a loophole around the non-runnable guarantee.
	const draftBlocksDrop = dragFromDraft && !(!isCustomColumn && status === "todo");

	// Can this column accept a cross-column drop?
	const isCrossColumnTarget = !draftBlocksDrop && (isCustomColumn
		// Custom columns accept drops from any column except themselves
		? (dragFromStatus !== null || dragFromCustomColumnId !== null) && dragFromCustomColumnId !== customColumnId
		// Built-in columns use transition logic; also accept from custom columns (underlying status governs)
		: dragFromStatus !== null && getAllowedTransitions(dragFromStatus).includes(status));

	useEffect(() => {
		function handleDragEnd() {
			setColumnDragSide(null);
		}
		window.addEventListener("dragend", handleDragEnd);
		return () => window.removeEventListener("dragend", handleDragEnd);
	}, []);

	function handleDragOver(e: React.DragEvent) {
		// Self-ID for drag: custom columns use customColumnId, built-in columns use status
		const myDragId = customColumnId ?? status;
		// Column reorder: use module-level variable set synchronously on dragstart.
		// dataTransfer.types is NOT used because WKWebView may reject custom MIME types.
		// Any column (built-in or custom) with onColumnDrop accepts a column reorder drop.
		if (onColumnDrop && _activeDragColumnId !== null && _activeDragColumnId !== myDragId) {
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
			setColumnDragSide(side);
			return;
		}
		// Task drag
		if (!isCrossColumnTarget) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
	}

	function handleDragEnter(e: React.DragEvent) {
		const myDragId = customColumnId ?? status;
		// Column reorder: must also preventDefault on dragenter for drop to fire
		if (onColumnDrop && _activeDragColumnId !== null && _activeDragColumnId !== myDragId) {
			e.preventDefault();
			return;
		}
		if (!isCrossColumnTarget) return;
		e.preventDefault();
		setDragOver(true);
	}

	function handleDragLeave(e: React.DragEvent) {
		if (e.currentTarget.contains(e.relatedTarget as Node)) return;
		setDragOver(false);
		setColumnDragSide(null);
	}

	function handleDrop(e: React.DragEvent) {
		e.preventDefault();
		setDragOver(false);

		// Column reorder drop (use module var; dataTransfer.getData won't have "dev3/column" in WKWebView)
		const myDragId = customColumnId ?? status;
		if (_activeDragColumnId && _activeDragColumnId !== myDragId && onColumnDrop && columnDragSide) {
			setColumnDragSide(null);
			onColumnDrop(columnDragSide);
			return;
		}
		setColumnDragSide(null);

		const taskId = e.dataTransfer.getData("text/plain");
		// Ignore col: prefixed data (column drags that fell through without a side set)
		if (!taskId || taskId.startsWith("col:")) return;

		if (isCustomColumn && customColumnId) {
			// Drop into a custom column
			onTaskDropToCustomColumn?.(taskId, customColumnId);
		} else if (isCrossColumnTarget) {
			onTaskDrop(taskId, status);
		}
	}

	const showDropHighlight = dragOver && isCrossColumnTarget;

	const visibleTasks = expanded ? tasks : tasks.slice(0, COLUMN_TASK_LIMIT);
	const hiddenCount = tasks.length - visibleTasks.length;

	// Re-measure the scroll edge whenever the rendered task set changes, plus on
	// any resize of the list itself (window height, sibling panes).
	useEffect(syncListClipped, [visibleTasks.length, expanded, tip]);
	useEffect(() => {
		const el = taskListRef.current;
		if (!el) return;
		const observer = new ResizeObserver(syncListClipped);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Pinned footers (tip card, + New Task) sit directly under the scroll area;
	// the hairline only appears while a card is actually clipped beneath them.
	const footerSeam = `border-t pt-2.5 transition-colors duration-150 ${listClipped ? "border-edge" : "border-transparent"}`;

	return (
		<>
		<div
			className={`group/col relative flex min-w-0 w-full flex-col glass-column column-glow rounded-xl border transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out ${
				showDropHighlight
					? "border-accent bg-accent/5 shadow-lg shadow-accent/10"
					: isCrossColumnTarget && (dragFromStatus || dragFromCustomColumnId)
						? "border-edge-active"
						: "border-transparent"
			} ${isDraggedColumn ? "opacity-40" : ""}`}
			style={{
				"--col-rgb": hexToRgb(color),
				// Column reorder indicator via box-shadow avoids dragleave false-fires
				// from pointer-events:none children extending outside element bounds.
				...(columnDragSide === "before" && { boxShadow: "-4px 0 0 0 rgb(var(--accent))" }),
				...(columnDragSide === "after" && { boxShadow: "4px 0 0 0 rgb(var(--accent))" }),
			} as React.CSSProperties}
			onDragOver={handleDragOver}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* Column header */}
			<div
				className="px-2 py-2 flex-shrink-0"
				style={{ borderBottom: `2px solid ${color}30` }}
			>
				<div className="flex items-center gap-1.5">
					{isCustomColumn && (
						<div
							className="cursor-grab active:cursor-grabbing text-fg-muted hover:text-fg-3 flex-shrink-0 select-none"
							draggable
							onDragStart={(e) => {
								e.stopPropagation();
								_activeDragColumnId = customColumnId ?? null;
								e.dataTransfer.setData("text/plain", `col:${customColumnId ?? ""}`);
								e.dataTransfer.effectAllowed = "move";
								onColumnDragStart?.();
							}}
							onDragEnd={(e) => {
								e.stopPropagation();
								_activeDragColumnId = null;
								onColumnDragEnd?.();
							}}
							title="Drag to reorder"
						>
							<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
								<circle cx="4" cy="3" r="1.2" />
								<circle cx="8" cy="3" r="1.2" />
								<circle cx="4" cy="6" r="1.2" />
								<circle cx="8" cy="6" r="1.2" />
								<circle cx="4" cy="9" r="1.2" />
								<circle cx="8" cy="9" r="1.2" />
							</svg>
						</div>
					)}
					<div
						className="w-2.5 h-2.5 rounded-full flex-shrink-0"
						style={{ background: color }}
					/>
					{editing ? (
						<input
							ref={renameInputRef}
							type="text"
							value={editValue}
							onChange={(e) => setEditValue(e.target.value)}
							onBlur={commitRename}
							onKeyDown={(e) => {
								if (e.key === "Enter") e.currentTarget.blur();
								if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(false); }
							}}
							className="text-fg text-sm font-semibold bg-transparent outline-none border-b border-accent flex-1 min-w-0"
							autoFocus
						/>
					) : (
						<span className="text-fg text-sm font-semibold truncate flex-1 min-w-0">
							{label}
						</span>
					)}
					{!editing && onRenameColumn && (
						<button
							onClick={startEditing}
							className="text-fg-muted hover:text-fg-3 transition-[color,opacity] duration-150 ease-out w-4 h-4 flex items-center justify-center text-xs leading-none flex-shrink-0 opacity-0 group-hover/col:opacity-100 focus:opacity-100"
							style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}
							aria-label={t("kanban.renameColumn")}
							title={t("kanban.renameColumn")}
						>
							{"\u{F11E7}"}
						</button>
					)}
					{!editing && (
						isCustomColumn ? (
							description ? (
								<HelpSpot
									content={{ title: label, body: description }}
									className="opacity-0 group-hover/col:opacity-100 focus:opacity-100"
								/>
							) : null
						) : (
							<HelpSpot
								topicId={statusHelpTopicId(status)}
								className="opacity-0 group-hover/col:opacity-100 focus:opacity-100"
							/>
						)
					)}
					{tasks.length > 0 && (
						<span
							className="text-dense font-bold px-1.5 py-px rounded-full flex-shrink-0"
							style={{
								color: inkColor,
								background: `${color}18`,
							}}
						>
							{tasks.length}
						</span>
					)}
				</div>
			</div>

			{/* Tasks */}
			<div
				ref={taskListRef}
				className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5"
				onScroll={syncListClipped}
				onDoubleClick={!isCustomColumn && status === "todo" ? (e) => {
					// Only trigger when clicking empty space, not on a task card
					if ((e.target as HTMLElement).closest("[data-task-id]")) return;
					onAddTask();
				} : undefined}
			>
				{visibleTasks.map((task) => (
					<div key={task.id} data-task-id={task.id}>
						<TaskCard
							task={task}
							project={project}
							dispatch={dispatch}
							navigate={navigate}
							agents={agents}
							onLaunchVariants={onLaunchVariants}
							onAddAttempts={onAddAttempts}
							onDragStart={onDragStart}
							bellCount={bellCounts.get(task.id) ?? 0}
							bellReasons={bellReasons?.get(task.id)}
							resourceUsage={taskResourceUsage?.get(task.id.slice(0, 8))}
							ports={taskPorts.get(task.id)}
							isActiveInSplit={task.id === activeTaskId}
							isMoving={movingTaskIds.has(task.id)}
							onSetMoving={onSetMoving}
							siblingMap={siblingMap}
							prInfo={taskPrMap?.get(task.id)}
							onOpenUnresolvedComments={onOpenUnresolvedComments}
							onEditDraft={onEditDraft}
							compact
						/>
					</div>
				))}
				{hiddenCount > 0 && (
					<button
						onClick={() => setExpanded(true)}
						className="w-full text-fg-muted hover:text-fg-2 text-xs text-center py-2 mt-1 rounded-lg hover:bg-raised-hover transition-[color,background-color,transform] duration-150 ease-out motion-safe:active:scale-[0.96]"
					>
						{t("kanban.showMore", { count: String(hiddenCount) })}
					</button>
				)}
				{expanded && tasks.length > COLUMN_TASK_LIMIT && (
					<button
						onClick={() => {
							setExpanded(false);
							taskListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
						}}
						className="w-full text-fg-muted hover:text-fg-2 text-xs text-center py-2 mt-1 rounded-lg hover:bg-raised-hover transition-colors"
					>
						{t("kanban.showLess")}
					</button>
				)}

				{tasks.length === 0 && !tip && (
					<div className="text-fg-muted text-xs text-center py-4">
						<p>{t("kanban.noTasks")}</p>
					</div>
				)}

				</div>

			{/* Tip card — pinned to bottom, above the add-task button */}
			{tip && tipState && onTipChanged && (
				<div className={`px-3 pb-3 flex-shrink-0 ${footerSeam}`}>
					<TipCard tip={tip} tipState={tipState} onChanged={onTipChanged} />
				</div>
			)}

			{/* Add task button (only in To Do column, not custom columns) */}
			{!isCustomColumn && status === "todo" && (
				<div className={`px-3 pb-3 flex-shrink-0 ${tip ? "" : footerSeam}`}>
					<button
						onClick={onAddTask}
						className="w-full text-fg-3 hover:text-accent text-sm font-medium text-center py-2.5 rounded-lg hover:bg-accent/10 border border-dashed border-edge hover:border-accent/30 transition-[color,background-color,border-color,transform] duration-150 ease-out motion-safe:active:scale-[0.96]"
					>
						{t("kanban.newTask")}
					</button>
				</div>
			)}
		</div>
		</>
	);
}

export default KanbanColumn;
