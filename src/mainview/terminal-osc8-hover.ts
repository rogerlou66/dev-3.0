import type { Terminal } from "ghostty-web";
import { cellFromMouseEvent } from "./terminal-cell-hit";
import type { Osc8RowLink } from "./terminal-osc8-links";

/**
 * Hover tooltip showing where an OSC 8 link actually points. The URI is
 * resolved from the visible label, and label and destination are independent
 * in the escape sequence — so without this surface nothing on screen would
 * ever reveal the target before the click (ghostty-web 0.4.0 never calls
 * `ILink.hover`, so the interface hook is not an option).
 *
 * ghostty-web owns the underline/cursor hover feedback; this overlay only adds
 * the URI text, positioned above the hovered cell (below it on the top row).
 */

export interface Osc8HoverHandle {
	dispose(): void;
}

export function installOsc8HoverTooltip(opts: {
	term: Terminal;
	container: HTMLElement;
	linkAt: (y: number, x: number) => Osc8RowLink | undefined;
}): Osc8HoverHandle {
	const { term, container, linkAt } = opts;
	if (typeof getComputedStyle === "function" && getComputedStyle(container).position === "static") {
		container.style.position = "relative";
	}
	const tooltip = document.createElement("div");
	tooltip.className =
		"absolute z-10 hidden max-w-full truncate rounded border border-edge bg-overlay px-1.5 py-0.5 font-mono text-xs text-fg-2 pointer-events-none";
	tooltip.dataset.role = "osc8-link-tooltip";
	container.appendChild(tooltip);

	let frameId: number | null = null;
	let pending: MouseEvent | null = null;
	let shownUri: string | null = null;

	function hide(): void {
		if (shownUri === null) return;
		shownUri = null;
		tooltip.classList.add("hidden");
	}

	function update(e: MouseEvent): void {
		const renderer = term.renderer;
		const canvas = renderer?.getCanvas();
		if (!renderer || !canvas || !renderer.charWidth || !renderer.charHeight) return hide();
		const cell = cellFromMouseEvent(term, e);
		if (!cell) return hide();
		const { viewportRow } = cell;
		const link = linkAt(cell.y, cell.x);
		if (!link) return hide();
		if (link.uri !== shownUri) {
			shownUri = link.uri;
			tooltip.textContent = link.uri;
			tooltip.classList.remove("hidden");
		}
		const left = canvas.offsetLeft + link.x0 * renderer.charWidth;
		const rowTop = canvas.offsetTop + viewportRow * renderer.charHeight;
		tooltip.style.left = `${Math.max(0, Math.min(left, container.clientWidth - tooltip.offsetWidth))}px`;
		// Above the hovered row; on the top row there is no "above", go below.
		tooltip.style.top =
			viewportRow === 0 ? `${rowTop + renderer.charHeight + 2}px` : `${rowTop - tooltip.offsetHeight - 2}px`;
	}

	function onMouseMove(e: MouseEvent): void {
		pending = e;
		if (frameId !== null) return;
		frameId = requestAnimationFrame(() => {
			frameId = null;
			if (pending) update(pending);
		});
	}

	function onMouseLeave(): void {
		pending = null;
		hide();
	}

	container.addEventListener("mousemove", onMouseMove, { passive: true });
	container.addEventListener("mouseleave", onMouseLeave, { passive: true });
	const scrollSub = term.onScroll(() => hide());

	return {
		dispose() {
			if (frameId !== null) cancelAnimationFrame(frameId);
			container.removeEventListener("mousemove", onMouseMove);
			container.removeEventListener("mouseleave", onMouseLeave);
			scrollSub.dispose();
			tooltip.remove();
		},
	};
}
