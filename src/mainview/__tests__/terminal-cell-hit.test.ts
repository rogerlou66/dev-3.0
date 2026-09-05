import { describe, it, expect } from "vitest";
import { cellFromMouseEvent } from "../terminal-cell-hit";
import type { Terminal } from "ghostty-web";

function fakeTerm(opts: { bufferLength?: number; viewportY?: number } = {}): Terminal {
	const canvas = document.createElement("canvas");
	canvas.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
	return {
		renderer: { charWidth: 10, charHeight: 20, getCanvas: () => canvas },
		buffer: { active: { length: opts.bufferLength ?? 24 } },
		rows: 24,
		cols: 80,
		viewportY: opts.viewportY ?? 0,
	} as unknown as Terminal;
}

function at(term: Terminal, clientX: number, clientY: number) {
	return cellFromMouseEvent(term, new MouseEvent("click", { clientX, clientY }));
}

describe("cellFromMouseEvent", () => {
	it("maps a point to the cell under it, relative to the canvas", () => {
		expect(at(fakeTerm(), 100, 50)).toEqual({ x: 0, y: 0, viewportRow: 0 });
		expect(at(fakeTerm(), 135, 91)).toEqual({ x: 3, y: 2, viewportRow: 2 });
	});

	it("offsets by the scrollback so the row is an absolute buffer row", () => {
		// 100 rows in the buffer, 24 on screen, scrolled to the bottom.
		expect(at(fakeTerm({ bufferLength: 100 }), 100, 50)?.y).toBe(76);
	});

	it("returns nothing outside the grid", () => {
		expect(at(fakeTerm(), 99, 50)).toBeUndefined();
		expect(at(fakeTerm(), 100, 49)).toBeUndefined();
		expect(at(fakeTerm(), 100 + 80 * 10, 50)).toBeUndefined();
		expect(at(fakeTerm(), 100, 50 + 24 * 20)).toBeUndefined();
	});

	it("returns nothing before the renderer has measured a cell", () => {
		const term = { renderer: { charWidth: 0, charHeight: 0, getCanvas: () => null } } as unknown as Terminal;
		expect(at(term, 10, 10)).toBeUndefined();
	});
});
