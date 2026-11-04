/**
 * The dev-server pane's wrapper script, authored in the platform launch dialect
 * (Seq 1546).
 *
 * It used to be hand-written bash stitched together inside `runDevServer`: a
 * `#!/bin/bash` shebang, `set -x`, `[ $EXIT_CODE -ne 0 ]`, `read -n 1 -s`. On
 * Windows the pane launched that text through `/bin/bash`, a path that does not
 * exist there — which is why the whole feature was dead on that platform.
 *
 * ONE thing this file does NOT solve, and cannot: {@link DevServerScriptOptions.devScript}
 * is the USER's own command, written in whatever shell they had in mind. dev3
 * spells the wrapper; it does not translate the body. A `VITE_PORT=${DEV3_PORT0}
 * bun run dev` remains POSIX text no matter which dialect surrounds it, and under
 * PowerShell it fails as a parse error. The wrapper's job is to stop being the
 * thing that breaks, and to make that failure the user's script rather than a
 * missing `/bin/bash`.
 */

import { indentLines, launchDialect } from "../shared/platform-launch";

export interface DevServerScriptOptions {
	/** The project's dev command, verbatim — see the file note above. */
	devScript: string;
	/**
	 * Environment blocks, in order. Each becomes its own paragraph so the pane's
	 * trace reads as project env / task env / ports rather than one wall.
	 */
	envGroups: Record<string, string>[];
	/**
	 * Appended to the script's last command, each argument quoted for the dialect,
	 * ahead of a trailing comment. {@link scriptArgsProblem} refuses a last line
	 * they cannot reach.
	 */
	scriptArgs?: string[];
	/**
	 * tmux only: the command that detaches the outer viewer client before this
	 * pane closes, which keeps the inner tmux redraw from corrupting the outer
	 * one. A native pane has no nesting and no tmux binary, so it passes null —
	 * and on Windows there is no tmux at all.
	 */
	tmuxDetachCommand?: string | null;
}

const EXIT_CODE_VAR = "EXIT_CODE";

/** Last-line endings after which appended words are no longer the command's arguments. */
const TRAILING_OPERATORS = ["&", "|", ";", "(", "{"];
/** A last word that closes or opens a block — words appended to it are a syntax error. */
const BLOCK_WORDS = new Set(["fi", "done", "esac", "then", "do", "else", "}", ")"]);

interface LastLine {
	head: string;
	code: string;
	comment: string;
	openQuote: boolean;
}

/**
 * The devScript's last line split into its code and a trailing `#` comment. A
 * small lexer, not a shell parser: quotes and the dialect's escape character are
 * enough to tell `# api` from `'#tag'` and `a#b`.
 */
function splitLastLine(devScript: string, escape: string): LastLine {
	const trimmed = devScript.trimEnd();
	const cut = trimmed.lastIndexOf("\n") + 1;
	const line = trimmed.slice(cut);
	let quote: string | null = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quote === "'") {
			if (ch === "'") quote = null;
		} else if (ch === escape) {
			i++;
		} else if (quote === '"') {
			if (ch === '"') quote = null;
		} else if (ch === "'" || ch === '"') {
			quote = ch;
		} else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
			return { head: trimmed.slice(0, cut), code: line.slice(0, i).trimEnd(), comment: line.slice(i), openQuote: false };
		}
	}
	return { head: trimmed.slice(0, cut), code: line, comment: "", openQuote: quote !== null };
}

function lastLineProblem({ code, openQuote }: LastLine, escape: string): string | null {
	if (openQuote) return "ends inside an open quote";
	const words = code.trim().split(/\s+/);
	const lastWord = words[words.length - 1];
	if (lastWord === "") return "has no command on it";
	// A trailing escape character is a line continuation: the command goes on below.
	if ([...TRAILING_OPERATORS, escape].some((op) => code.endsWith(op))) return `ends with "${code.slice(-1)}"`;
	if (BLOCK_WORDS.has(lastWord)) return `ends with "${lastWord}"`;
	return null;
}

function escapeCharOf(): string {
	return launchDialect().id === "windows-powershell" ? "`" : "\\";
}

/**
 * Why script args cannot be appended to this devScript, or null when they can.
 * Checked before a start touches anything, so a refused start leaves the running
 * server and the remembered args as they were.
 */
export function scriptArgsProblem(devScript: string): string | null {
	const escape = escapeCharOf();
	const reason = lastLineProblem(splitLastLine(devScript, escape), escape);
	if (!reason) return null;
	return `Script arguments are appended to the last line of the dev server's script, and that line ${reason}. `
		+ "End the script with the command that should receive them, or start it without arguments.";
}

function appendScriptArgs(devScript: string, quotedArgs: string): string {
	const problem = scriptArgsProblem(devScript);
	if (problem) throw new Error(problem);
	const { head, code, comment } = splitLastLine(devScript, escapeCharOf());
	return `${head}${code.trimEnd()} ${quotedArgs}${comment ? ` ${comment}` : ""}`;
}

/** The wrapper text for one dev-server pane, in the current platform's dialect. */
export function buildDevServerScript(options: DevServerScriptOptions): string {
	const d = launchDialect();
	const envParagraphs = options.envGroups
		.filter((group) => Object.keys(group).length > 0)
		.flatMap((group) => [...d.envLines(group), ""]);
	const failNotice = d.print("Process exited with code %s. Press any key to close.", {
		blankBefore: true,
		args: [d.exitCodeArg(EXIT_CODE_VAR)],
	});
	return [
		...d.header(),
		...envParagraphs,
		// Only the user's command is traced: the exports above are dev3's business.
		d.traceOn(),
		options.scriptArgs?.length
			? appendScriptArgs(options.devScript, options.scriptArgs.map(d.nativeArg).join(" "))
			: options.devScript,
		d.captureExitCode(EXIT_CODE_VAR),
		d.traceOff(),
		...d.branchOnFailure(EXIT_CODE_VAR, { fail: indentLines(2, [failNotice, d.readKey()]) }),
		...(options.tmuxDetachCommand ? [options.tmuxDetachCommand] : []),
	].join("\n") + "\n";
}
