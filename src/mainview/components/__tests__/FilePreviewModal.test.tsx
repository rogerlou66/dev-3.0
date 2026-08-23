import { render, screen, waitFor } from "@testing-library/react";
import FilePreviewModal from "../FilePreviewModal";
import { I18nProvider } from "../../i18n";
import type { FilePreviewResult } from "../../../shared/types";

const readFilePreview = vi.fn<(params: { path: string }) => Promise<FilePreviewResult>>();
const openTerminalPath = vi.hoisted(() => vi.fn());
const androidRuntime = vi.hoisted(() => ({ enabled: false }));

// isElectrobun=false — the browser/remote case, where host-side open actions
// must not render (they would act invisibly on the host machine).
vi.mock("../../rpc", () => ({
	isElectrobun: false,
	api: {
		request: {
			get readFilePreview() {
				return readFilePreview;
			},
			openTerminalPath,
		},
	},
}));

vi.mock("../../android-client-bridge", () => ({
	isAndroidAppHost: () => androidRuntime.enabled,
}));

function renderModal(path = "/wt/docs/guide.md", line?: number) {
	return render(
		<I18nProvider>
			<FilePreviewModal path={path} line={line} onClose={vi.fn()} />
		</I18nProvider>,
	);
}

describe("FilePreviewModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		androidRuntime.enabled = false;
	});

	it("offers explicit computer-side open actions in the Android app", async () => {
		androidRuntime.enabled = true;
		readFilePreview.mockResolvedValue({ kind: "text", content: "hello", truncated: false, size: 5 });
		renderModal("/wt/docs/guide.txt");

		const reveal = await screen.findByRole("button", { name: "Open folder on computer" });
		const open = screen.getByRole("button", { name: "Open in default app on computer" });
		reveal.click();
		open.click();
		await waitFor(() => expect(openTerminalPath).toHaveBeenCalledTimes(2));
		expect(openTerminalPath).toHaveBeenNthCalledWith(1, { path: "/wt/docs/guide.txt", mode: "reveal" });
		expect(openTerminalPath).toHaveBeenNthCalledWith(2, { path: "/wt/docs/guide.txt", mode: "system" });
	});

	it("hides host-side open actions in browser mode but keeps copy actions", async () => {
		readFilePreview.mockResolvedValue({ kind: "text", content: "# Hi\n", truncated: false, size: 5 });
		renderModal();
		await waitFor(() => expect(screen.getByText("Copy content")).toBeInTheDocument());
		expect(screen.getByText("Copy path")).toBeInTheDocument();
		expect(screen.queryByText("Open folder")).not.toBeInTheDocument();
		expect(screen.queryByText("Open in default app")).not.toBeInTheDocument();
	});

	it("shows filename and directory as separate header lines", async () => {
		readFilePreview.mockResolvedValue({ kind: "text", content: "x", truncated: false, size: 1 });
		renderModal("/wt/docs/guide.md");
		expect(screen.getByRole("heading", { name: "guide.md" })).toBeInTheDocument();
		expect(screen.getByText("/wt/docs")).toBeInTheDocument();
	});

	it("renders markdown by default with a Raw toggle", async () => {
		readFilePreview.mockResolvedValue({
			kind: "text",
			content: "# Title\nbody",
			truncated: false,
			size: 12,
		});
		renderModal("/wt/docs/guide.md");
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Title", level: 1 })).toBeInTheDocument(),
		);
		expect(screen.getByRole("button", { name: "Raw" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Rendered" })).toHaveAttribute("aria-pressed", "true");
	});

	it("renders code with line numbers and highlights the target line", async () => {
		readFilePreview.mockResolvedValue({
			kind: "text",
			content: "one\ntwo\nthree",
			truncated: false,
			size: 13,
		});
		renderModal("/wt/src/a.ts", 2);
		await waitFor(() => expect(screen.getByText("two")).toBeInTheDocument());
		expect(screen.getByText("3")).toBeInTheDocument(); // gutter
		expect(screen.getByText("two").parentElement?.className).toContain("bg-accent/10");
		expect(screen.getByText("one").parentElement?.className).not.toContain("bg-accent/10");
		// No markdown toggle for non-markdown files.
		expect(screen.queryByRole("button", { name: "Raw" })).not.toBeInTheDocument();
	});

	it("shows the not-found state without any open actions", async () => {
		readFilePreview.mockResolvedValue({ kind: "not-found" });
		renderModal("/nope/missing.txt");
		await waitFor(() =>
			expect(screen.getByText(/File not found/)).toBeInTheDocument(),
		);
		expect(screen.queryByText("Copy content")).not.toBeInTheDocument();
		expect(screen.queryByText("Open folder")).not.toBeInTheDocument();
	});
});
