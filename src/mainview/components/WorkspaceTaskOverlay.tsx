import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import { getTaskTitle, type Project, type SharedArtifact, type Task } from "../../shared/types";
import type { AppAction, Route } from "../state";
import type { NavigationGuard } from "../navigation-guard";
import { api } from "../rpc";
import { useT } from "../i18n";
import { useBackLayer } from "../hooks/useBackLayer";
import { dismissTopOverlayLayer, getOverlayLayerElements } from "../utils/overlay-layers";
import TaskWorkspaceView from "./TaskWorkspaceView";

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

interface WorkspaceTaskOverlayProps {
	projectId: string;
	taskId: string;
	tasks: Task[];
	projects: Project[];
	dispatch: Dispatch<AppAction>;
	navigate: (route: Route) => void;
	onRequestClose: () => void;
	onOpenFullPage: () => void;
	onTaskMissing: () => void;
	navigationGuardRef?: MutableRefObject<NavigationGuard | null>;
	artifactViewer?: { taskId: string; artifacts: SharedArtifact[]; index: number } | null;
	onCloseArtifactViewer?: () => void;
	skipCopyModeReset?: boolean;
}

function collectFocusable(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true",
	);
}

function WorkspaceTaskOverlay({
	projectId,
	taskId,
	tasks,
	projects,
	dispatch,
	navigate,
	onRequestClose,
	onOpenFullPage,
	onTaskMissing,
	navigationGuardRef,
	artifactViewer,
	onCloseArtifactViewer,
	skipCopyModeReset,
}: WorkspaceTaskOverlayProps) {
	const t = useT();
	const dialogRef = useRef<HTMLDivElement>(null);
	const onTaskMissingRef = useRef(onTaskMissing);
	onTaskMissingRef.current = onTaskMissing;
	const [loadError, setLoadError] = useState<string | null>(null);
	const task = tasks.find((candidate) => candidate.id === taskId);
	const project = projects.find((candidate) => candidate.id === projectId);

	useBackLayer(onRequestClose);

	const refresh = useCallback(async () => {
		setLoadError(null);
		try {
			const loaded = await api.request.getTasks({ projectId });
			if (!loaded.some((candidate) => candidate.id === taskId)) {
				onTaskMissingRef.current();
				return;
			}
			dispatch({ type: "setTasks", projectId, tasks: loaded });
		} catch (error) {
			setLoadError(String(error));
		}
	}, [dispatch, projectId, taskId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		dialog.focus({ preventScroll: true });
		if (!window.matchMedia("(pointer: fine)").matches) return;

		const focusTerminal = () => {
			const terminal = dialog.querySelector<HTMLElement>('[data-terminal="true"]');
			if (!terminal) return false;
			terminal.focus({ preventScroll: true });
			return true;
		};
		if (focusTerminal()) return;
		const observer = new MutationObserver(() => {
			if (focusTerminal()) observer.disconnect();
		});
		observer.observe(dialog, { childList: true, subtree: true });
		const timeout = window.setTimeout(() => observer.disconnect(), 2_000);
		return () => {
			observer.disconnect();
			window.clearTimeout(timeout);
		};
	}, [taskId]);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const dialog = dialogRef.current;
			if (!dialog) return;
			const terminal = dialog.querySelector<HTMLElement>('[data-terminal="true"]');
			if (terminal?.contains(document.activeElement)) return;

			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (!dismissTopOverlayLayer()) onRequestClose();
				return;
			}
			if (event.key !== "Tab") return;

			const layers = getOverlayLayerElements().filter((element) => !dialog.contains(element));
			const topLayer = layers[layers.length - 1];
			const focusables = topLayer ? collectFocusable(topLayer) : collectFocusable(dialog);
			if (focusables.length === 0) {
				event.preventDefault();
				dialog.focus();
				return;
			}
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement;
			const activeInside = active instanceof HTMLElement && (topLayer ?? dialog).contains(active);
			if (event.shiftKey && (active === first || !activeInside)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !activeInside)) {
				event.preventDefault();
				first.focus();
			}
		}
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onRequestClose]);

	const title = project && task
		? `${project.name} / #${task.seq} / ${getTaskTitle(task)}`
		: t("workspaceTaskOverlay.title");

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-0 md:p-[6vh_4vw]"
			data-testid="workspace-task-overlay"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) onRequestClose();
			}}
		>
			<section
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="workspace-task-overlay-title"
				tabIndex={-1}
				data-full-bleed
				data-help-id="dashboard.workspace-task-overlay"
				className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-overlay shadow-2xl outline-none md:h-[88dvh] md:w-[92vw] md:max-w-[112rem] md:rounded-2xl md:border md:border-edge-active"
			>
				<header className="flex min-h-11 flex-shrink-0 items-center gap-3 border-b border-edge bg-overlay px-3">
					<h2 id="workspace-task-overlay-title" className="min-w-0 flex-1 truncate text-sm font-semibold text-fg streamer-private">
						{title}
					</h2>
					<button
						type="button"
						onClick={onOpenFullPage}
						aria-label={t("workspaceTaskOverlay.openFullPage")}
						className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-edge bg-raised px-2.5 text-xs font-medium text-fg-2 transition-[background-color,color,border-color] hover:border-edge-active hover:bg-raised-hover hover:text-fg md:min-h-8 md:min-w-0"
					>
						<span aria-hidden="true" style={{ fontFamily: "'JetBrainsMono Nerd Font Mono'" }}>{"\uF065"}</span>
						<span className="hidden sm:inline">{t("workspaceTaskOverlay.openFullPage")}</span>
					</button>
					<button
						type="button"
						onClick={onRequestClose}
						aria-label={t("workspaceTaskOverlay.close")}
						className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-fg-3 transition-[background-color,color] hover:bg-raised-hover hover:text-fg md:min-h-6 md:min-w-6"
					>
						<span aria-hidden="true" className="text-base leading-none">×</span>
					</button>
				</header>
				{loadError && (
					<div role="alert" className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
						<span>{t("workspaceTaskOverlay.loadFailed", { error: loadError })}</span>
						<button type="button" onClick={() => void refresh()} className="rounded-lg border border-warning/40 px-3 py-1.5 font-semibold hover:bg-warning/10">
							{t("workspaceTaskOverlay.retry")}
						</button>
					</div>
				)}
				<div className="flex min-h-0 flex-1 flex-col">
					{task && project ? (
						<TaskWorkspaceView
							projectId={projectId}
							taskId={taskId}
							tasks={tasks}
							projects={projects}
							navigate={navigate}
							dispatch={dispatch}
							navigationGuardRef={navigationGuardRef}
							artifactViewer={artifactViewer}
							onCloseArtifactViewer={onCloseArtifactViewer}
							presentation="overlay"
							skipCopyModeReset={skipCopyModeReset}
							loadTasks={false}
						/>
					) : (
						<div className="flex h-full items-center justify-center text-sm text-fg-3">{t("workspaceTaskOverlay.loading")}</div>
					)}
				</div>
			</section>
		</div>
	);
}

export default WorkspaceTaskOverlay;
