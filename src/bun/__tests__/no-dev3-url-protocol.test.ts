import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("removed dev3 URL protocol", () => {
	it("does not register or expose external task links", () => {
		expect(read("electrobun.config.ts")).not.toMatch(/urlSchemes\s*:/);
		expect(read("src/mainview/components/TaskContextMenu.tsx")).not.toMatch(/buildTaskDeepLink|copyDeepLink|dev3:\/\//);
		expect(read("src/bun/rpc-handlers/app-handlers.ts")).not.toContain("resolveDeepLinkNav");
	});

	it("keeps protocol parsers and terminal providers out of the fork", () => {
		for (const path of ["src/shared/deep-link.ts", "src/mainview/terminal-deep-links.ts"]) {
			expect(existsSync(fileURLToPath(new URL(path, root))), path).toBe(false);
		}
		expect(read("src/mainview/terminal-osc8-links.ts")).not.toContain("parseDeepLink");
	});
});
