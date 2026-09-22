// Queue CLI task navigation until a reopened renderer is ready to consume it.
import type { TaskNavigationTarget } from "../shared/types";

let pendingNavigation: TaskNavigationTarget | null = null;

export function markPendingTaskNavigation(target: TaskNavigationTarget): void {
	pendingNavigation = target;
}

export function consumePendingTaskNavigation(): TaskNavigationTarget | null {
	const target = pendingNavigation;
	pendingNavigation = null;
	return target;
}
