import { useLayoutEffect, useState, type RefObject } from "react";

export interface ViewportPosition {
	top: number;
	left: number;
}

const EDGE_PAD = 8;

/**
 * Keeps an absolutely-positioned overlay inside the viewport.
 *
 * A portal anchored to a trigger's `getBoundingClientRect()` overflows as soon as
 * the trigger sits near an edge — which on a 390px phone is most of the time. The
 * overlay renders hidden for one frame, gets measured, then flips visible at a
 * clamped position, so it never paints off-screen.
 *
 * `contentKey` re-measures when content that arrives after opening changes the
 * overlay's size — a line loaded on open would otherwise widen it past the edge.
 */
export function useViewportClamp(
	ref: RefObject<HTMLElement | null>,
	position: ViewportPosition,
	contentKey?: unknown,
): { position: ViewportPosition; visible: boolean } {
	const [clamped, setClamped] = useState(position);
	const [visible, setVisible] = useState(false);

	useLayoutEffect(() => {
		if (!ref.current) return;

		const box = ref.current.getBoundingClientRect();
		const maxTop = window.innerHeight - box.height - EDGE_PAD;
		const maxLeft = window.innerWidth - box.width - EDGE_PAD;

		setClamped({
			top: Math.max(EDGE_PAD, Math.min(position.top, maxTop)),
			left: Math.max(EDGE_PAD, Math.min(position.left, maxLeft)),
		});
		setVisible(true);
	}, [ref, position, contentKey]);

	return { position: clamped, visible };
}
