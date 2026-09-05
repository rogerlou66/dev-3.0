import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardHeaderControls from "../DashboardHeaderControls";
import { I18nProvider } from "../../i18n";
import { closeTopBackLayer } from "../../back-navigation";

function Harness({ disabled = false }: { disabled?: boolean }) {
	const [query, setQuery] = useState("");
	const [surface, setSurface] = useState<"board" | "projects">("board");
	return <I18nProvider><header><DashboardHeaderControls surface={surface} onSurfaceChange={setSurface} query={query} onQueryChange={setQuery} disabled={disabled} /></header><button>Outside</button></I18nProvider>;
}

describe("Dashboard compact search", () => {
	beforeEach(() => {
		const original = window.matchMedia;
		vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...original(query), matches: query === "(max-width: 767px)" }));
	});
	afterEach(() => vi.restoreAllMocks());
	it("focuses search, preserves the filter after Escape and view switches, and restores focus", async () => {
		render(<Harness />);
		const user = userEvent.setup();
		const trigger = screen.getByRole("button", { name: "Search tasks and projects…" });
		await user.click(trigger);
		const input = screen.getByRole("textbox");
		expect(input).toHaveFocus();
		await user.type(input, "is:blocked");
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
		await user.click(screen.getByRole("button", { name: "Projects" }));
		expect(screen.queryByRole("button", { name: "Search tasks and projects…" })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Board" }));
		await user.click(screen.getByRole("button", { name: "Search tasks and projects…" }));
		expect(screen.getByRole("textbox")).toHaveValue("is:blocked");
	});
	it("dismisses on Back or outside click without stealing the outside target focus", async () => {
		render(<Harness />);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Search tasks and projects…" }));
		act(() => { expect(closeTopBackLayer()).toBe(true); });
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Search tasks and projects…" }));
		await user.click(screen.getByRole("button", { name: "Outside" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
	});
	it("releases Escape when the task workspace makes the header inactive", async () => {
		const { rerender } = render(<Harness />);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Search tasks and projects…" }));
		rerender(<Harness disabled />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(closeTopBackLayer()).toBe(false);
		const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});
});
