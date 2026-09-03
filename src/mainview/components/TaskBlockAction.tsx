import { useState, type Dispatch } from "react";
import type { Task } from "../../shared/types";
import { canBlockTask, isTaskBlocked } from "../../shared/task-blocking";
import type { AppAction } from "../state";
import { useT } from "../i18n";
import { setTaskBlocked } from "../utils/setTaskBlocked";

/** One action inside existing status menus; no extra card or toolbar control. */
export default function TaskBlockAction({ task, dispatch, onClose }: {
	task: Task;
	dispatch: Dispatch<AppAction>;
	onClose: () => void;
}) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const blocked = isTaskBlocked(task);
	if (!blocked && !canBlockTask(task)) return null;
	return <button type="button" disabled={busy} className="flex min-h-11 w-full items-center gap-2 border-t border-edge px-4 py-2 text-left text-sm text-fg-2 hover:bg-elevated-hover disabled:opacity-50"
		onClick={(event) => {
			event.stopPropagation();
			void setTaskBlocked({ task, blocked: !blocked, dispatch, t, onMovingChange: setBusy });
			onClose();
		}}>
		<span aria-hidden="true">{blocked ? "▶" : "Ⅱ"}</span>
		{t(blocked ? "task.unblock" : "task.block")}
	</button>;
}
