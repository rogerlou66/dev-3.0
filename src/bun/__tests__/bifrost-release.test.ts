import { describe, expect, it } from "vitest";
import { BIFROST_TARGETS, BIFROST_VERSION, bifrostPinKey, bifrostTarget } from "../../shared/bifrost-release";

describe("bifrostTarget", () => {
	it("uses the vendor's own platform and arch names, not Node's", () => {
		expect(bifrostTarget("darwin", "x64")?.url).toContain("/darwin/amd64/");
		expect(bifrostTarget("win32", "x64")?.url).toContain("/windows/amd64/");
		expect(bifrostTarget("linux", "ia32")?.url).toContain("/linux/386/");
	});

	it("gives Windows the executable extension", () => {
		expect(bifrostTarget("win32", "x64")?.binaryName).toBe("bifrost-http.exe");
		expect(bifrostTarget("darwin", "arm64")?.binaryName).toBe("bifrost-http");
	});

	it("pins the version into the download path", () => {
		expect(bifrostTarget("darwin", "arm64")?.url).toContain(`/${BIFROST_VERSION}/`);
	});

	it("refuses to guess a URL for a target the vendor does not publish", () => {
		expect(bifrostTarget("darwin", "ia32")).toBeUndefined();
		expect(bifrostTarget("freebsd", "x64")).toBeUndefined();
		expect(bifrostTarget("linux", "mips")).toBeUndefined();
	});

	it("has a resolvable download for every target dev3 ships", () => {
		for (const { platform, arch } of BIFROST_TARGETS) {
			expect(bifrostTarget(platform, arch), `${platform}/${arch}`).toBeTruthy();
		}
	});

	it("keys a pin by platform and arch, so one hash cannot cover two builds", () => {
		expect(bifrostPinKey("darwin", "arm64")).toBe("darwin-arm64");
		expect(new Set(BIFROST_TARGETS.map((t) => bifrostPinKey(t.platform, t.arch))).size).toBe(BIFROST_TARGETS.length);
	});
});
