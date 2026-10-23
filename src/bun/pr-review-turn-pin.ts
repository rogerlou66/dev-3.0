/**
 * Keeps a card in PR Review while its own agent works on the PR Review prompt.
 *
 * The prompt is typed into the task's primary agent, so the turn it starts fires
 * the same status hooks as any other turn: Agent is Working on the first tool call,
 * Your Review on Stop. While a pin is held those hook moves are ignored, and the
 * turn's end (Stop, Interrupt, SessionEnd, StopFailure) releases it, so a later
 * turn addressing PR feedback moves the card as it always did.
 *
 * In memory on purpose: a restart drops the pin, and the worst outcome is the card
 * moving the way it would without this feature.
 */

import type { Task, TaskStatus } from "../shared/types";

const PIN_TTL_MS = 2 * 60 * 60 * 1000;
const PINNED_COLUMN: TaskStatus = "review-by-colleague";
/** The statuses the agent's own hooks move a card to; nothing else is held back. */
const HOOK_TARGETS: ReadonlySet<string> = new Set(["in-progress", "review-by-user", "user-questions"]);

const pins = new Map<string, number>();

export function pinPrReviewTurn(taskId: string, now: number = Date.now()): void {
	pins.set(taskId, now + PIN_TTL_MS);
}

export function releasePrReviewTurn(taskId: string): void {
	pins.delete(taskId);
}

/** True while the card sits in PR Review with a live pin; a stale pin is dropped on sight. */
export function isPrReviewTurnPinned(task: Pick<Task, "id" | "status" | "customColumnId">, now: number = Date.now()): boolean {
	const expiresAt = pins.get(task.id);
	if (expiresAt === undefined) return false;
	if (now >= expiresAt || task.status !== PINNED_COLUMN || task.customColumnId != null) {
		pins.delete(task.id);
		return false;
	}
	return true;
}

/** Whether a task's own `dev3 task move` is a status-hook move the pin must swallow. */
export function isPinnedHookMove(task: Pick<Task, "id" | "status" | "customColumnId">, newStatus: string): boolean {
	return HOOK_TARGETS.has(newStatus) && isPrReviewTurnPinned(task);
}
