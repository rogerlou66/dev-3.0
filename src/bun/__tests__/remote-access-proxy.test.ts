import { describe, it, expect, vi } from "vitest";

vi.mock("electrobun/bun", () => ({
	PATHS: { VIEWS_FOLDER: "/nonexistent-views" },
	Utils: {},
	Updater: { localInfo: { version: vi.fn(), hash: vi.fn(), channel: vi.fn() } },
}));
vi.mock("../logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../jwt", () => ({
	initSecret: vi.fn(),
	createQrToken: vi.fn(),
	createSessionToken: vi.fn(),
	exchangeQrForSession: vi.fn(),
	refreshSession: vi.fn(),
	revokeSessionToken: vi.fn(),
	verifySessionToken: vi.fn(),
}));
vi.mock("../settings", () => ({ loadSettingsSync: () => ({}) }));
vi.mock("../theme-state", () => ({ getCurrentUiTheme: () => "dark" }));

import { parseSharedProxyPath, sharedProxyHostMatches, stripProxyHeaders } from "../remote-access-server";

describe("parseSharedProxyPath", () => {
	it("parses /p/<subtoken>/<port>/<rest>", () => {
		const r = parseSharedProxyPath("/p/abc123/3000/api/users");
		expect(r).toEqual({ subToken: "abc123", port: 3000, rest: "api/users" });
	});

	it("parses with empty rest", () => {
		const r = parseSharedProxyPath("/p/abc/5173/");
		expect(r).toEqual({ subToken: "abc", port: 5173, rest: "" });
	});

	it("accepts URL-safe base64 subtokens (the actual format minted by crypto.randomBytes)", () => {
		const r = parseSharedProxyPath("/p/AbC-123_xyZ/3000/static/foo.js");
		expect(r?.subToken).toBe("AbC-123_xyZ");
		expect(r?.port).toBe(3000);
		expect(r?.rest).toBe("static/foo.js");
	});

	it("rejects malformed paths", () => {
		expect(parseSharedProxyPath("/p/")).toBeNull();
		expect(parseSharedProxyPath("/p/abc")).toBeNull();
		expect(parseSharedProxyPath("/p//3000/foo")).toBeNull();
		expect(parseSharedProxyPath("/p/abc/notanumber/foo")).toBeNull();
	});

	it("rejects out-of-range ports", () => {
		expect(parseSharedProxyPath("/p/abc/0/foo")).toBeNull();
		expect(parseSharedProxyPath("/p/abc/70000/foo")).toBeNull();
		expect(parseSharedProxyPath("/p/abc/-1/foo")).toBeNull();
	});

	it("rejects ports with trailing garbage (would silently parse as int otherwise)", () => {
		expect(parseSharedProxyPath("/p/abc/3000abc/foo")).toBeNull();
	});
});

describe("stripProxyHeaders", () => {
	it("never forwards dev3 credentials to a proxied localhost app", () => {
		const headers = stripProxyHeaders(new Headers({
			cookie: "dev3_session=secret",
			authorization: "Bearer secret",
			connection: "keep-alive",
			accept: "text/html",
			"set-cookie": "dev3_session=attacker; Path=/",
		}));
		expect(headers.get("cookie")).toBeNull();
		expect(headers.get("authorization")).toBeNull();
		expect(headers.get("connection")).toBeNull();
		expect(headers.get("set-cookie")).toBeNull();
		expect(headers.get("accept")).toBe("text/html");
	});
});

describe("sharedProxyHostMatches", () => {
	it("binds the capability URL to its dedicated tunnel hostname", () => {
		expect(sharedProxyHostMatches("task.trycloudflare.com", "https://task.trycloudflare.com")).toBe(true);
		expect(sharedProxyHostMatches("main.trycloudflare.com", "https://task.trycloudflare.com")).toBe(false);
		expect(sharedProxyHostMatches(null, "https://task.trycloudflare.com")).toBe(false);
	});
});
