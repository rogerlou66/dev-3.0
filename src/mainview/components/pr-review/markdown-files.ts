/** Which file paths dev3 can show as a rendered document instead of source. */

export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

/** Standalone Mermaid diagram source (`.mmd`), rendered as a single diagram. */
export function isMermaidPath(path: string): boolean {
	return /\.mmd$/i.test(path);
}

export function isRenderableDocPath(path: string): boolean {
	return isMarkdownPath(path) || isMermaidPath(path);
}

/** A `.mmd` file is diagram source, not markdown: fencing it is what makes the
 * markdown renderer's mermaid plugin draw it. */
export function toRenderableMarkdown(content: string, path: string): string {
	return isMermaidPath(path) ? `\`\`\`mermaid\n${content.trimEnd()}\n\`\`\`` : content;
}
