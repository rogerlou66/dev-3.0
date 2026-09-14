import { describe, it, expect } from "vitest";
import {
	hookCliDialect,
	POSIX_DEV3_CLI,
	hookCliCommandPath,
	resolveDev3CliPath,
	resolveHookCliPath,
	windowsDev3CliCandidates,
} from "../../shared/dev3-cli-path";

const EXEC_DIR = "C:\\Program Files\\dev3\\bin";
const HOME = "C:\\Users\\dev";

describe("resolveHookCliPath", () => {
	it.each(["darwin", "linux"] as const)("prefers the current %s bundle over the shared CLI", (platform) => {
		const bundled = "/apps/dev3 dev/Contents/Resources/app/cli/dev3";
		expect(resolveHookCliPath({ platform, execPath: "/apps/dev3 dev/Contents/MacOS/bun", exists: (p) => p === bundled }))
			.toBe(bundled);
	});
	it("uses the running headless CLI before another installed binary", () => {
		expect(resolveHookCliPath({ platform: "linux", execPath: "/opt/dev3/dev3", exists: () => true }))
			.toBe("/opt/dev3/dev3");
	});
	it("supports Windows bundle paths without shell quoting", () => {
		const bundled = "C:\\Program Files\\dev3\\cli\\dev3.exe";
		expect(resolveHookCliPath({ platform: "win32", execPath: "C:\\Program Files\\dev3\\bun.exe", exists: (p) => p === bundled }))
			.toBe(bundled);
	});
	it("uses a source-built CLI when the runtime is unbundled Bun", () => {
		const sourceCliPath = "/checkout/src/cli/dev3";
		expect(resolveHookCliPath({ platform: "darwin", execPath: "/usr/local/bin/bun", sourceCliPath, exists: (p) => p === sourceCliPath }))
			.toBe(sourceCliPath);
	});
	it("retains the shared fallback without mistaking Bun for a CLI", () => {
		expect(resolveHookCliPath({ platform: "darwin", execPath: "/usr/local/bin/bun", exists: () => false }))
			.toBe(POSIX_DEV3_CLI);
	});
});

describe("windowsDev3CliCandidates", () => {
	it("prefers the CLI bundled next to the running binary, then Resources/app, then the user dir", () => {
		expect(windowsDev3CliCandidates(EXEC_DIR, HOME)).toEqual([
			"C:\\Program Files\\dev3\\bin\\cli\\dev3.exe",
			"C:\\Program Files\\dev3\\Resources\\app\\cli\\dev3.exe",
			"C:\\Users\\dev\\.dev3.0\\bin\\dev3.exe",
		]);
	});

	it("drops the candidates whose anchor is unknown", () => {
		expect(windowsDev3CliCandidates(undefined, HOME)).toEqual(["C:\\Users\\dev\\.dev3.0\\bin\\dev3.exe"]);
		expect(windowsDev3CliCandidates(EXEC_DIR, undefined)).toHaveLength(2);
		expect(windowsDev3CliCandidates(undefined, undefined)).toEqual([]);
	});
});

describe("resolveDev3CliPath", () => {
	it("returns the frozen POSIX string on darwin and linux, without touching the filesystem", () => {
		const exists = () => {
			throw new Error("must not probe the filesystem on POSIX");
		};
		expect(resolveDev3CliPath({ platform: "darwin", exists })).toBe(POSIX_DEV3_CLI);
		expect(resolveDev3CliPath({ platform: "linux", exists })).toBe(POSIX_DEV3_CLI);
	});

	it("picks the first Windows candidate that exists", () => {
		const path = resolveDev3CliPath({
			platform: "win32",
			execDir: EXEC_DIR,
			homeDir: HOME,
			exists: (candidate) => candidate === "C:\\Program Files\\dev3\\Resources\\app\\cli\\dev3.exe",
		});
		expect(path).toBe("C:\\Program Files\\dev3\\Resources\\app\\cli\\dev3.exe");
	});

	it("falls back to the per-user install dir when nothing exists yet", () => {
		const path = resolveDev3CliPath({
			platform: "win32",
			execDir: EXEC_DIR,
			homeDir: HOME,
			exists: () => false,
		});
		expect(path).toBe("C:\\Users\\dev\\.dev3.0\\bin\\dev3.exe");
	});

	it("never emits a tilde on Windows", () => {
		const path = resolveDev3CliPath({ platform: "win32", execDir: EXEC_DIR, homeDir: HOME, exists: () => false });
		expect(path).not.toContain("~");
	});
});

describe("hookCliCommandPath", () => {
	it("turns separators into forward slashes so bash cannot eat them", () => {
		expect(hookCliCommandPath("C:\\dev3\\dev3.exe")).toBe('"C:/dev3/dev3.exe"');
	});

	it("quotes unconditionally, so a path with spaces stays one argument", () => {
		expect(hookCliCommandPath("C:\\Program Files\\dev3.exe")).toBe('"C:/Program Files/dev3.exe"');
	});
});

describe("hookCliDialect", () => {
	it("keeps POSIX shell semantics off Windows", () => {
		expect(hookCliDialect({ platform: "darwin" })).toEqual({ cli: POSIX_DEV3_CLI, posixShell: true });
		expect(hookCliDialect({ platform: "linux" })).toEqual({ cli: POSIX_DEV3_CLI, posixShell: true });
	});

	it("quotes a Windows path that contains spaces", () => {
		expect(
			hookCliDialect({
				platform: "win32",
				execDir: EXEC_DIR,
				homeDir: "C:\\Users\\John Doe",
				exists: () => false,
			}),
		).toEqual({
			cli: '"C:/Users/John Doe/.dev3.0/bin/dev3.exe"',
			posixShell: false,
		});
	});

	it("gives Windows an absolute CLI and no POSIX shell", () => {
		expect(hookCliDialect({ platform: "win32", execDir: EXEC_DIR, homeDir: HOME, exists: () => false })).toEqual({
			cli: '"C:/Users/dev/.dev3.0/bin/dev3.exe"',
			posixShell: false,
		});
	});

	it("never emits a bare backslash — Git Bash would strip it (the hook repro)", () => {
		const cli = hookCliDialect({ platform: "win32", execDir: "C:\\dev3", homeDir: "C:\\home", exists: () => false }).cli;
		expect(cli).toBe('"C:/home/.dev3.0/bin/dev3.exe"');
		expect(cli).not.toContain("\\");
	});
});
