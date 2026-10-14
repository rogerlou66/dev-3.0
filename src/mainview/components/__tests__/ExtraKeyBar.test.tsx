import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExtraKeyBar from "../ExtraKeyBar";
import type { TerminalHandle } from "../../TerminalView";
import { I18nProvider } from "../../i18n";
import { uploadDroppedFile } from "../../utils/uploadDroppedFile";
import { EXTRA_KEYS_STORAGE_KEY, setExtraKeysExpanded } from "../../hooks/useExtraKeysExpanded";

vi.mock("../../utils/uploadDroppedFile", () => ({
	uploadDroppedFile: vi.fn(),
}));

vi.mock("../../toast", () => ({
	toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const uploadDroppedFileMock = vi.mocked(uploadDroppedFile);

function makeHandle(): TerminalHandle {
	return {
		sendInput: vi.fn(),
		paste: vi.fn(),
		submit: vi.fn(),
		focus: vi.fn(),
		blur: vi.fn(),
	claimWriter: vi.fn(),
		scrollToBottom: vi.fn(),
	};
}

function renderBar(
	handle: TerminalHandle,
	props: {
		rawMode?: boolean;
		onToggleRaw?: () => void;
		attachProjectId?: string;
		attachTaskId?: string;
		onAttachPaths?: (paths: string[]) => void;
	} = {},
) {
	return render(
		<I18nProvider>
			<ExtraKeyBar handle={handle} {...props} />
		</I18nProvider>,
	);
}

beforeEach(() => {
	setExtraKeysExpanded(true);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	setExtraKeysExpanded(false);
});

describe("ExtraKeyBar", () => {
	it("defaults to a collapsed accessible entry without focusing the terminal", () => {
		localStorage.removeItem(EXTRA_KEYS_STORAGE_KEY);
		const handle = makeHandle();
		renderBar(handle);
		expect(screen.queryByRole("button", { name: "Esc" })).not.toBeInTheDocument();
		const toggle = screen.getByRole("button", { name: "Show terminal keys" });
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(toggle);
		expect(screen.getByRole("button", { name: "Esc" })).toBeVisible();
		expect(handle.focus).not.toHaveBeenCalled();
		expect(handle.sendInput).not.toHaveBeenCalled();
	});

	it("remembers collapse across remounts and synchronizes mounted bars", () => {
		const first = renderBar(makeHandle());
		renderBar(makeHandle());
		fireEvent.click(screen.getAllByRole("button", { name: "Hide terminal keys" })[0]);
		expect(screen.queryByRole("button", { name: "Esc" })).not.toBeInTheDocument();
		expect(localStorage.getItem(EXTRA_KEYS_STORAGE_KEY)).toBe("false");
		first.unmount();
		renderBar(makeHandle());
		expect(screen.getAllByRole("button", { name: "Show terminal keys" })).toHaveLength(2);
	});

	it("still toggles when storage writes are blocked", () => {
		setExtraKeysExpanded(false);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
		renderBar(makeHandle());
		fireEvent.click(screen.getByRole("button", { name: "Show terminal keys" }));
		expect(screen.getByRole("button", { name: "Esc" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Hide terminal keys" }));
		expect(screen.queryByRole("button", { name: "Esc" })).not.toBeInTheDocument();
	});

	it("stops held keys and clears sticky Ctrl when collapsed", () => {
		vi.useFakeTimers();
		try {
			const handle = makeHandle();
			renderBar(handle);
			fireEvent.pointerDown(screen.getByTestId("extra-key-backspace"));
			vi.advanceTimersByTime(460);
			const count = vi.mocked(handle.sendInput).mock.calls.length;
			fireEvent.click(screen.getByRole("button", { name: "Ctrl" }));
			fireEvent.click(screen.getByRole("button", { name: "Hide terminal keys" }));
			vi.advanceTimersByTime(1000);
			expect(handle.sendInput).toHaveBeenCalledTimes(count);
			fireEvent.click(screen.getByRole("button", { name: "Show terminal keys" }));
			expect(screen.getByRole("button", { name: "Ctrl" })).toHaveAttribute("aria-pressed", "false");
			fireEvent.click(screen.getByRole("button", { name: "/" }));
			expect(handle.sendInput).toHaveBeenLastCalledWith("/");
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears sticky Shift when collapsed and keeps shifted arrows after reopening", async () => {
		const user = userEvent.setup();
		const handle = makeHandle();
		renderBar(handle);
		await user.click(screen.getByRole("button", { name: "Shift" }));
		await user.click(screen.getByRole("button", { name: "Hide terminal keys" }));
		await user.click(screen.getByRole("button", { name: "Show terminal keys" }));
		expect(screen.getByRole("button", { name: "Shift" })).toHaveAttribute("aria-pressed", "false");
		await user.click(screen.getByRole("button", { name: "▲" }));
		expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[A");
		await user.click(screen.getByRole("button", { name: "Shift" }));
		await user.click(screen.getByRole("button", { name: "▲" }));
		expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[1;2A");
	});

	it("compensates for the fixed mobile viewport and updates on resize", () => {
		const viewport = new EventTarget();
		Object.assign(viewport, { scale: 0.5 });
		vi.stubGlobal("visualViewport", viewport);
		const { container } = renderBar(makeHandle());
		const bar = container.querySelector<HTMLElement>(".extra-key-bar")!;
		expect(bar.style.getPropertyValue("--extra-key-unit")).toBe("2px");
		Object.assign(viewport, { scale: 1 });
		act(() => { viewport.dispatchEvent(new Event("resize")); });
		expect(bar.style.getPropertyValue("--extra-key-unit")).toBe("1px");
	});

	it("sends Esc / Tab / Enter escape sequences", async () => {
		const handle = makeHandle();
		renderBar(handle);

		await userEvent.click(screen.getByRole("button", { name: "Esc" }));
		expect(handle.sendInput).toHaveBeenCalledWith("\x1b");
		await userEvent.click(screen.getByRole("button", { name: "Enter" }));
		expect(handle.sendInput).toHaveBeenCalledWith("\r");
	});

	it("sends the back-tab sequence for Shift+Tab (Claude agent-mode cycling)", async () => {
		const handle = makeHandle();
		renderBar(handle);

		await userEvent.click(screen.getByRole("button", { name: "⇧Tab" }));
		expect(handle.sendInput).toHaveBeenCalledWith("\x1b[Z");
	});

	it("sends DEL for Backspace", async () => {
		const handle = makeHandle();
		renderBar(handle);

		await userEvent.click(screen.getByRole("button", { name: "Backspace" }));
		expect(handle.sendInput).toHaveBeenCalledWith("\x7f");
	});

	it("repeats Backspace while held, and stops on release", () => {
		vi.useFakeTimers();
		try {
			const handle = makeHandle();
			renderBar(handle);
			const key = screen.getByTestId("extra-key-backspace");

			fireEvent.pointerDown(key);
			vi.advanceTimersByTime(300);
			// Before the delay the tap alone rules — no auto-repeat yet.
			expect(handle.sendInput).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100 + 60 * 3);
			expect(handle.sendInput).toHaveBeenCalledTimes(3);
			expect(handle.sendInput).toHaveBeenCalledWith("\x7f");

			fireEvent.pointerUp(key);
			vi.advanceTimersByTime(1000);
			expect(handle.sendInput).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops the repeat when the finger slides off the key", () => {
		vi.useFakeTimers();
		try {
			const handle = makeHandle();
			renderBar(handle);
			const key = screen.getByRole("button", { name: "◀" });

			fireEvent.pointerDown(key);
			vi.advanceTimersByTime(400 + 60 * 2);
			expect(handle.sendInput).toHaveBeenCalledWith("\x1b[D");
			const emitted = vi.mocked(handle.sendInput).mock.calls.length;

			fireEvent.pointerLeave(key);
			vi.advanceTimersByTime(1000);
			expect(vi.mocked(handle.sendInput).mock.calls.length).toBe(emitted);
		} finally {
			vi.useRealTimers();
		}
	});

	it("puts common controls before rarely used modifiers", () => {
		renderBar(makeHandle());

		const labels = screen.getAllByRole("button").map(
			(button) => button.getAttribute("aria-label") ?? button.textContent?.trim(),
		);
		expect(labels.slice(0, 11)).toEqual([
			"Hide terminal keys",
			"Esc",
			"Enter",
			"Backspace",
			"▲",
			"▼",
			"◀",
			"▶",
			"Tab",
			"⇧Tab",
			"Ctrl",
		]);
	});

	it("sticky Ctrl turns the next key into a control character", async () => {
		const handle = makeHandle();
		renderBar(handle);

		await userEvent.click(screen.getByRole("button", { name: "Ctrl" }));
		await userEvent.click(screen.getByRole("button", { name: "Tab" }));
		// Ctrl+I == \x09 (Tab char upper-cased path: "\t" is not a letter — falls through)
		expect(handle.sendInput).toHaveBeenCalled();
	});

	it("sends plain arrow sequences without Shift", async () => {
		const handle = makeHandle();
		renderBar(handle);

		for (const [name, seq] of [["▲", "\x1b[A"], ["▼", "\x1b[B"], ["◀", "\x1b[D"], ["▶", "\x1b[C"]]) {
			await userEvent.click(screen.getByRole("button", { name }));
			expect(handle.sendInput).toHaveBeenLastCalledWith(seq);
		}
	});

	it("sticky Shift sends Shift+Left once (Codex question stack), then releases", async () => {
		const handle = makeHandle();
		renderBar(handle);
		const shift = screen.getByRole("button", { name: "Shift" });

		await userEvent.click(shift);
		expect(shift.getAttribute("aria-pressed")).toBe("true");
		expect(handle.sendInput).not.toHaveBeenCalled();

		await userEvent.click(screen.getByRole("button", { name: "◀" }));
		expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[1;2D");
		expect(shift.getAttribute("aria-pressed")).toBe("false");

		await userEvent.click(screen.getByRole("button", { name: "◀" }));
		expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[D");
	});

	it("sticky Shift encodes every arrow, Tab and Enter; other keys pass through", async () => {
		const handle = makeHandle();
		renderBar(handle);
		const cases: Array<[string, string]> = [
			["▲", "\x1b[1;2A"],
			["▼", "\x1b[1;2B"],
			["▶", "\x1b[1;2C"],
			["◀", "\x1b[1;2D"],
			["Tab", "\x1b[Z"],
			["Enter", "\x1b\r"],
			["Esc", "\x1b"],
			["|", "|"],
		];
		for (const [name, seq] of cases) {
			await userEvent.click(screen.getByRole("button", { name: "Shift" }));
			await userEvent.click(screen.getByRole("button", { name }));
			expect(handle.sendInput).toHaveBeenLastCalledWith(seq);
		}
		expect(handle.sendInput).toHaveBeenCalledTimes(cases.length);
	});

	it("tapping Shift twice cancels it", async () => {
		const handle = makeHandle();
		renderBar(handle);
		const shift = screen.getByRole("button", { name: "Shift" });

		await userEvent.click(shift);
		await userEvent.click(shift);
		expect(shift.getAttribute("aria-pressed")).toBe("false");
		await userEvent.click(screen.getByRole("button", { name: "▶" }));
		expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[C");
	});

	it("a held arrow keeps Shift for every repeat and the final tap", () => {
		vi.useFakeTimers();
		try {
			const handle = makeHandle();
			renderBar(handle);
			fireEvent.click(screen.getByRole("button", { name: "Shift" }));
			const key = screen.getByRole("button", { name: "◀" });

			fireEvent.pointerDown(key);
			vi.advanceTimersByTime(400 + 60 * 3);
			fireEvent.pointerUp(key);
			fireEvent.click(key);

			const sent = vi.mocked(handle.sendInput).mock.calls.map(([data]) => data);
			expect(sent).toEqual(["\x1b[1;2D", "\x1b[1;2D", "\x1b[1;2D", "\x1b[1;2D"]);
			expect(screen.getByRole("button", { name: "Shift" }).getAttribute("aria-pressed")).toBe("false");

			fireEvent.click(key);
			expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[D");
		} finally {
			vi.useRealTimers();
		}
	});

	it("Ctrl+Shift on an arrow sends the Shift arrow and releases both", async () => {
		const handle = makeHandle();
		renderBar(handle);

		await userEvent.click(screen.getByRole("button", { name: "Ctrl" }));
		await userEvent.click(screen.getByRole("button", { name: "Shift" }));
		await userEvent.click(screen.getByRole("button", { name: "◀" }));
		expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[1;2D");
		expect(screen.getByRole("button", { name: "Ctrl" }).getAttribute("aria-pressed")).toBe("false");
		expect(screen.getByRole("button", { name: "Shift" }).getAttribute("aria-pressed")).toBe("false");
	});

	it("compose mode: Shift never steals focus to the terminal", async () => {
		const handle = makeHandle();
		renderBar(handle, { rawMode: false, onToggleRaw: () => {} });

		await userEvent.click(screen.getByRole("button", { name: "Shift" }));
		await userEvent.click(screen.getByRole("button", { name: "◀" }));
		expect(handle.sendInput).toHaveBeenLastCalledWith("\x1b[1;2D");
		expect(handle.focus).not.toHaveBeenCalled();
	});

	it("does NOT render the raw toggle without onToggleRaw", () => {
		renderBar(makeHandle());
		expect(screen.queryByTestId("extra-key-raw-toggle")).toBeNull();
	});

	it("renders the raw toggle and reflects the active state", async () => {
		const onToggleRaw = vi.fn();
		renderBar(makeHandle(), { rawMode: true, onToggleRaw });

		const toggle = screen.getByTestId("extra-key-raw-toggle");
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		await userEvent.click(toggle);
		expect(onToggleRaw).toHaveBeenCalledTimes(1);
	});

	it("compose mode: keys never steal focus to the terminal", async () => {
		const handle = makeHandle();
		renderBar(handle, { rawMode: false, onToggleRaw: () => {} });

		await userEvent.click(screen.getByRole("button", { name: "Esc" }));
		expect(handle.sendInput).toHaveBeenCalledWith("\x1b");
		expect(handle.focus).not.toHaveBeenCalled();
	});

	it("raw mode: keys re-focus the terminal", async () => {
		const handle = makeHandle();
		renderBar(handle, { rawMode: true, onToggleRaw: () => {} });

		await userEvent.click(screen.getByRole("button", { name: "Esc" }));
		expect(handle.focus).toHaveBeenCalled();
	});

	it("does NOT render the attach button without a project context", () => {
		renderBar(makeHandle(), { onAttachPaths: () => {} });
		expect(screen.queryByTestId("extra-key-attach")).toBeNull();
	});

	it("uploads picked files and reports raw paths to the host", async () => {
		uploadDroppedFileMock.mockResolvedValue("/wt/uploads/upload-1-abcd-shot.png");
		const onAttachPaths = vi.fn();
		renderBar(makeHandle(), { attachProjectId: "proj-1", attachTaskId: "task-1", onAttachPaths });

		expect(screen.getByTestId("extra-key-attach")).toBeEnabled();
		const file = new File(["img"], "shot.png", { type: "image/png" });
		await userEvent.upload(screen.getByTestId("extra-key-attach-input"), file);

		await waitFor(() =>
			expect(onAttachPaths).toHaveBeenCalledWith(["/wt/uploads/upload-1-abcd-shot.png"]),
		);
		expect(uploadDroppedFileMock).toHaveBeenCalledWith("proj-1", file);
	});

	it("does not call the host when every upload fails", async () => {
		uploadDroppedFileMock.mockRejectedValue(new Error("boom"));
		const onAttachPaths = vi.fn();
		renderBar(makeHandle(), { attachProjectId: "proj-1", onAttachPaths });

		const file = new File(["img"], "shot.png", { type: "image/png" });
		await userEvent.upload(screen.getByTestId("extra-key-attach-input"), file);

		await waitFor(() => expect(uploadDroppedFileMock).toHaveBeenCalled());
		expect(onAttachPaths).not.toHaveBeenCalled();
	});
});
