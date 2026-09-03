import type { Dispatch } from "react";
import type { Task } from "../../shared/types";
import type { AppAction } from "../state";
import type { TFunction } from "../i18n";
import { api } from "../rpc";
import { toast } from "../toast";

export async function setTaskBlocked({ task, blocked, dispatch, t, onMovingChange }: {
	task: Task;
	blocked: boolean;
	dispatch: Dispatch<AppAction>;
	t: TFunction;
	onMovingChange?: (moving: boolean) => void;
}): Promise<void> {
	onMovingChange?.(true);
	dispatch({ type: "updateTask", task: { ...task, blocked, blockedAt: blocked ? new Date().toISOString() : null } });
	try {
		const updated = await api.request.setTaskBlocked({ projectId: task.projectId, taskId: task.id, blocked });
		dispatch({ type: "updateTask", task: updated });
	} catch (error) {
		dispatch({ type: "updateTask", task });
		toast.error(t("task.failedBlock", { error: String(error) }), { taskId: task.id });
	} finally {
		onMovingChange?.(false);
	}
}
