import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installOsc8HoverTooltip } from "../terminal-osc8-hover";
import type { Terminal } from "ghostty-web";
import type { Osc8RowLink } from "../terminal-osc8-links";

function fakeTerm(): Terminal {
	const canvas = document.createElement("canvas");
	return {
		renderer: { charWidth: 10, charHeight: 20, getCanvas: () => canvas },
		buffer: { active: { length: 24 } },
		rows: 24,
		cols: 80,
		viewportY: 0,
		onScroll: () => ({ dispose: () => {} }),
	} as unknown as Terminal;
}

let frames: FrameRequestCallback[] = [];

function mouseMove(target: HTMLElement, x: number, y: number): void {
	target.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
	const pending = frames;
	frames = [];
	for (const cb of pending) cb(0);
}

describe("installOsc8HoverTooltip", () => {
	let container: HTMLElement;

	beforeEach(() => {
		frames = [];
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
		vi.stubGlobal("cancelAnimationFrame", () => {});
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		container.remove();
	});

	function tooltip(): HTMLElement {
		return container.querySelector('[data-role="osc8-link-tooltip"]') as HTMLElement;
	}

	it("shows the resolved URI over a linked cell and hides off it", () => {
		const term = fakeTerm();
		const linkAt = vi.fn((y: number, x: number): Osc8RowLink | undefined =>
			y === 1 && x >= 2 && x <= 6 ? { uri: "https://x.dev/pr/7", x0: 2, x1: 6 } : undefined,
		);
		const handle = installOsc8HoverTooltip({ term, container, linkAt });

		// (clientX 25, clientY 30) → col 2, viewport row 1 → absolute row 1.
		mouseMove(container, 25, 30);
		expect(linkAt).toHaveBeenCalledWith(1, 2);
		expect(tooltip().textContent).toBe("https://x.dev/pr/7");
		expect(tooltip().classList.contains("hidden")).toBe(false);

		mouseMove(container, 25, 90);
		expect(tooltip().classList.contains("hidden")).toBe(true);
		handle.dispose();
	});

	it("hides on mouseleave and removes itself on dispose", () => {
		const term = fakeTerm();
		const handle = installOsc8HoverTooltip({
			term,
			container,
			linkAt: () => ({ uri: "https://a.dev", x0: 0, x1: 3 }),
		});
		mouseMove(container, 5, 5);
		expect(tooltip().classList.contains("hidden")).toBe(false);
		container.dispatchEvent(new MouseEvent("mouseleave"));
		expect(tooltip().classList.contains("hidden")).toBe(true);
		handle.dispose();
		expect(container.querySelector('[data-role="osc8-link-tooltip"]')).toBeNull();
	});

	it("maps a scrolled viewport row to the right absolute buffer row", () => {
		const term = fakeTerm();
		Object.assign(term, { viewportY: 10 });
		(term.buffer.active as { length: number }).length = 124; // 100 rows of scrollback
		const linkAt = vi.fn(() => undefined);
		const handle = installOsc8HoverTooltip({ term, container, linkAt });
		// viewport row 3 while scrolled up 10 rows → absolute row 100 - 10 + 3 = 93.
		mouseMove(container, 5, 70);
		expect(linkAt).toHaveBeenCalledWith(93, 0);
		handle.dispose();
	});
});
