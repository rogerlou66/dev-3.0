import { isMarkdownPath, isMermaidPath, isRenderableDocPath, toRenderableMarkdown } from "../markdown-files";

describe("markdown-files", () => {
	it("recognizes markdown and mermaid documents by extension", () => {
		expect(isMarkdownPath("docs/guide.md")).toBe(true);
		expect(isMarkdownPath("docs/GUIDE.Markdown")).toBe(true);
		expect(isMarkdownPath("docs/chart.mmd")).toBe(false);

		expect(isMermaidPath("docs/chart.mmd")).toBe(true);
		expect(isMermaidPath("docs/CHART.MMD")).toBe(true);
		expect(isMermaidPath("docs/guide.md")).toBe(false);

		expect(isRenderableDocPath("docs/chart.mmd")).toBe(true);
		expect(isRenderableDocPath("docs/guide.md")).toBe(true);
		expect(isRenderableDocPath("src/a.ts")).toBe(false);
		// Not a suffix match: `.mmdx` and `readme.mdx` are other formats.
		expect(isRenderableDocPath("docs/chart.mmdx")).toBe(false);
		expect(isRenderableDocPath("docs/readme.mdx")).toBe(false);
	});

	it("fences mermaid sources and leaves markdown untouched", () => {
		expect(toRenderableMarkdown("flowchart LR\nA --> B\n", "docs/chart.mmd"))
			.toBe("```mermaid\nflowchart LR\nA --> B\n```");
		expect(toRenderableMarkdown("# Title\n", "docs/guide.md")).toBe("# Title\n");
	});
});
