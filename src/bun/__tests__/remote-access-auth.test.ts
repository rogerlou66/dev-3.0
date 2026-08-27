/**
 * Handler-level tests for the cookie-based remote auth flow (decision 132).
 *
 * Unlike remote-access-server.test.ts, this file does NOT mock ../jwt — the
 * exchange/refresh handlers run against the real JWT module with a temp-dir
 * secret file, so cookie issuance, validation, and restart survival are
 * exercised end-to-end at the Request/Response seam.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("electrobun/bun", () => ({
	PATHS: { VIEWS_FOLDER: "/nonexistent-views" },
	Utils: {},
	Updater: {
		localInfo: {
			version: vi.fn().mockResolvedValue("0.0.0-test"),
			hash: vi.fn().mockResolvedValue("deadbeef"),
			channel: vi.fn().mockResolvedValue("dev"),
		},
	},
}));

vi.mock("../logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock("../cloudflare-tunnel", () => ({
	getTunnelUrl: vi.fn().mockReturnValue(null),
	getTunnelState: vi.fn().mockReturnValue("stopped"),
	tunnelManager: { list: vi.fn().mockReturnValue([]) },
}));

// checkOrigin honors X-Forwarded-Host only under a custom tunnel provider;
// tests flip this instead of the settings file on disk.
const tunnelProviderMocks = vi.hoisted(() => ({
	customActive: { value: false },
}));

vi.mock("../tunnel-provider", () => ({
	isCustomTunnelProviderActive: () => tunnelProviderMocks.customActive.value,
}));

vi.mock("../settings", () => ({
	loadSettingsSync: vi.fn(() => ({ theme: "light", resolvedTheme: "light" })),
}));

vi.mock("../theme-state", () => ({
	getCurrentUiTheme: vi.fn(() => "dark"),
}));

vi.mock("qrcode", () => ({
	default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,test") },
}));

import {
	SESSION_COOKIE_NAME,
	parseCookies,
	buildSessionCookie,
	buildClearSessionCookie,
	checkOrigin,
	handleAuthExchange,
	handleArtifactDownload,
	handleAuthLogout,
	handleAuthRefresh,
} from "../remote-access-server";
import { initSecret, createQrToken, _resetForTests } from "../jwt";

const testSecretDir = join(tmpdir(), `dev3-remote-auth-test-${process.pid}`);
const testSecretFile = join(testSecretDir, "remote-jwt-secret");

beforeEach(async () => {
	delete process.env.DEV3_REMOTE_STATIC_CODE;
	_resetForTests();
	rmSync(testSecretDir, { recursive: true, force: true });
	await initSecret(testSecretFile);
});

afterAll(() => {
	rmSync(testSecretDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────

function exchangeRequest(token: string, headers: Record<string, string> = {}): Request {
	return new Request("http://192.168.1.10:4242/auth/exchange", {
		method: "POST",
		headers: { "Content-Type": "application/json", host: "192.168.1.10:4242", ...headers },
		body: JSON.stringify({ token }),
	});
}

function refreshRequest(cookie?: string, headers: Record<string, string> = {}): Request {
	return new Request("http://192.168.1.10:4242/auth/refresh", {
		method: "POST",
		headers: {
			host: "192.168.1.10:4242",
			...(cookie ? { cookie } : {}),
			...headers,
		},
	});
}

function logoutRequest(cookie?: string): Request {
	return new Request("http://192.168.1.10:4242/auth/logout", {
		method: "POST",
		headers: { host: "192.168.1.10:4242", origin: "http://192.168.1.10:4242", ...(cookie ? { cookie } : {}) },
	});
}

function artifactRequest(token: string, cookie?: string, method = "GET"): Request {
	return new Request(`http://192.168.1.10:4242/api/artifact-download/${token}`, {
		method,
		headers: { host: "192.168.1.10:4242", ...(cookie ? { cookie } : {}) },
	});
}

/** Extract the session token value from a Set-Cookie header. */
function cookieValue(setCookie: string | null): string | null {
	if (!setCookie) return null;
	const match = setCookie.match(new RegExp(`^${SESSION_COOKIE_NAME}=([^;]*)`));
	return match ? match[1] : null;
}

// ── parseCookies ─────────────────────────────────────────────────────

describe("parseCookies", () => {
	it("returns empty record for null/empty header", () => {
		expect(parseCookies(null)).toEqual({});
		expect(parseCookies("")).toEqual({});
	});

	it("parses a single cookie", () => {
		expect(parseCookies("dev3_session=abc.def.ghi")).toEqual({ dev3_session: "abc.def.ghi" });
	});

	it("parses multiple cookies and trims whitespace", () => {
		expect(parseCookies("foo=1; dev3_session=tok; bar=2")).toEqual({
			foo: "1",
			dev3_session: "tok",
			bar: "2",
		});
	});

	it("ignores malformed fragments without '='", () => {
		expect(parseCookies("garbage; dev3_session=tok")).toEqual({ dev3_session: "tok" });
	});
});

// ── Cookie builders ──────────────────────────────────────────────────

describe("session cookie builders", () => {
	it("buildSessionCookie sets HttpOnly, SameSite=Strict, Path=/ and a 24h Max-Age", () => {
		const cookie = buildSessionCookie("tok123");
		expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok123`);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Strict");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain(`Max-Age=${24 * 60 * 60}`);
		// LAN mode is plain http — the Secure flag must NOT be present.
		expect(cookie).not.toContain("Secure");
	});

	it("buildClearSessionCookie expires the cookie immediately", () => {
		const cookie = buildClearSessionCookie();
		expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
		expect(cookie).toContain("Max-Age=0");
	});

	it("adds Secure only for HTTPS-facing sessions", () => {
		expect(buildSessionCookie("tok123", true)).toContain("; Secure");
		expect(buildClearSessionCookie(true)).toContain("; Secure");
		expect(buildSessionCookie("tok123")).not.toContain("; Secure");
	});
});

// ── checkOrigin ──────────────────────────────────────────────────────

describe("checkOrigin", () => {
	function reqWith(headers: Record<string, string>): Request {
		return new Request("http://10.0.0.5:4242/rpc", { headers });
	}

	it("allows a matching same-origin request", () => {
		expect(checkOrigin(reqWith({ host: "10.0.0.5:4242", origin: "http://10.0.0.5:4242" }))).toBe(true);
	});

	it("allows a matching https tunnel origin through the trusted forwarded protocol", () => {
		expect(checkOrigin(reqWith({
			host: "foo.trycloudflare.com",
			origin: "https://foo.trycloudflare.com",
			"x-forwarded-proto": "https",
		}))).toBe(true);
	});

	it("rejects a same-host origin with the wrong scheme", () => {
		expect(checkOrigin(reqWith({ host: "10.0.0.5:4242", origin: "https://10.0.0.5:4242" }))).toBe(false);
	});

	it("rejects a foreign origin (CSWSH)", () => {
		expect(checkOrigin(reqWith({ host: "10.0.0.5:4242", origin: "http://evil.example.com" }))).toBe(false);
	});

	it("rejects a same-host different-port origin", () => {
		expect(checkOrigin(reqWith({ host: "10.0.0.5:4242", origin: "http://10.0.0.5:9999" }))).toBe(false);
	});

	it("allows a request without Origin header (non-browser client)", () => {
		expect(checkOrigin(reqWith({ host: "10.0.0.5:4242" }))).toBe(true);
		expect(checkOrigin(reqWith({ host: "10.0.0.5:4242" }), true)).toBe(false);
	});

	it("rejects an unparseable Origin header", () => {
		expect(checkOrigin(reqWith({ host: "10.0.0.5:4242", origin: "not a url" }))).toBe(false);
	});

	// Host-rewriting tunnel proxies: Host arrives as localhost:<port>, the
	// public hostname rides in X-Forwarded-Host — honored only while a custom
	// provider is configured, because the header is client-controlled on a
	// direct connection.
	describe("with a custom tunnel provider configured", () => {
		beforeEach(() => {
			tunnelProviderMocks.customActive.value = true;
		});
		afterEach(() => {
			tunnelProviderMocks.customActive.value = false;
		});

		it("allows Origin matching X-Forwarded-Host when the proxy rewrote Host", () => {
			expect(checkOrigin(reqWith({
				host: "localhost:4242",
				"x-forwarded-host": "me-app.tunnel.example.com",
				origin: "https://me-app.tunnel.example.com",
			}))).toBe(true);
		});

		it("uses only the first X-Forwarded-Host entry when proxies chain", () => {
			expect(checkOrigin(reqWith({
				host: "localhost:4242",
				"x-forwarded-host": "me-app.tunnel.example.com, inner.proxy.local",
				origin: "https://me-app.tunnel.example.com",
			}))).toBe(true);
			expect(checkOrigin(reqWith({
				host: "localhost:4242",
				"x-forwarded-host": "me-app.tunnel.example.com, evil.example.com",
				origin: "https://evil.example.com",
			}))).toBe(false);
		});

		it("still rejects a foreign origin when X-Forwarded-Host is present", () => {
			expect(checkOrigin(reqWith({
				host: "localhost:4242",
				"x-forwarded-host": "me-app.tunnel.example.com",
				origin: "https://evil.example.com",
			}))).toBe(false);
		});
	});

	// The case that would have caught the ungated version: an attacker who
	// controls the request controls BOTH Origin and X-Forwarded-Host, making
	// the check compare a value against itself.
	it("rejects an attacker setting both Origin and X-Forwarded-Host on the default provider", () => {
		expect(checkOrigin(reqWith({
			host: "abc.trycloudflare.com",
			"x-forwarded-host": "evil.com",
			origin: "https://evil.com",
		}))).toBe(false);
		expect(checkOrigin(reqWith({
			host: "192.168.1.5:4242",
			"x-forwarded-host": "evil.com",
			origin: "https://evil.com",
		}))).toBe(false);
	});

	it("ignores X-Forwarded-Host entirely while the built-in provider is active", () => {
		// Host-preserving cloudflared still matches on Host, so nothing breaks…
		expect(checkOrigin(reqWith({
			host: "abc.trycloudflare.com",
			"x-forwarded-host": "whatever.example.com",
			origin: "https://abc.trycloudflare.com",
		}))).toBe(true);
		// …and a rewritten Host without a custom provider does not authenticate.
		expect(checkOrigin(reqWith({
			host: "localhost:4242",
			"x-forwarded-host": "me-app.tunnel.example.com",
			origin: "https://me-app.tunnel.example.com",
		}))).toBe(false);
	});
});

// ── /auth/exchange ───────────────────────────────────────────────────

describe("handleAuthExchange (QR flow)", () => {
	it("exchanges a valid QR token for a session cookie", async () => {
		const qr = await createQrToken();
		const resp = await handleAuthExchange(exchangeRequest(qr));
		expect(resp.status).toBe(200);
		const setCookie = resp.headers.get("set-cookie");
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("SameSite=Strict");
		expect(cookieValue(setCookie)).toBeTruthy();
		// Body must NOT leak the token — the cookie is the only carrier.
		const body = await resp.json();
		expect(body).toEqual({ ok: true });
	});

	it("rejects a replayed QR token with 401 and no cookie", async () => {
		const qr = await createQrToken();
		await handleAuthExchange(exchangeRequest(qr));
		const resp = await handleAuthExchange(exchangeRequest(qr));
		expect(resp.status).toBe(401);
		expect(resp.headers.get("set-cookie")).toBeNull();
	});

	it("rejects a garbage token with 401", async () => {
		const resp = await handleAuthExchange(exchangeRequest("not.a.jwt"));
		expect(resp.status).toBe(401);
	});

	it("rejects a missing token with 400", async () => {
		const req = new Request("http://h/auth/exchange", {
			method: "POST",
			headers: { "Content-Type": "application/json", host: "h" },
			body: JSON.stringify({}),
		});
		const resp = await handleAuthExchange(req);
		expect(resp.status).toBe(400);
	});

	it("rejects a foreign Origin with 403 before touching the body", async () => {
		const qr = await createQrToken();
		const resp = await handleAuthExchange(exchangeRequest(qr, { origin: "http://evil.example.com" }));
		expect(resp.status).toBe(403);
	});

	it("fires onQrConsumed on success only", async () => {
		const onQrConsumed = vi.fn();
		await handleAuthExchange(exchangeRequest("bad-token"), { onQrConsumed });
		expect(onQrConsumed).not.toHaveBeenCalled();
		const qr = await createQrToken();
		await handleAuthExchange(exchangeRequest(qr), { onQrConsumed });
		expect(onQrConsumed).toHaveBeenCalledOnce();
	});
});

describe("handleAuthExchange (static code)", () => {
	beforeEach(() => {
		process.env.DEV3_REMOTE_STATIC_CODE = "sesame";
	});

	it("accepts the static code and sets a session cookie", async () => {
		const resp = await handleAuthExchange(exchangeRequest("sesame"));
		expect(resp.status).toBe(200);
		expect(cookieValue(resp.headers.get("set-cookie"))).toBeTruthy();
	});

	it("rejects a wrong code with 401", async () => {
		const resp = await handleAuthExchange(exchangeRequest("wrong"));
		expect(resp.status).toBe(401);
	});

	it("rejects a valid QR JWT while static code mode is active", async () => {
		const qr = await createQrToken();
		const resp = await handleAuthExchange(exchangeRequest(qr));
		expect(resp.status).toBe(401);
	});
});

// ── /auth/refresh ────────────────────────────────────────────────────

describe("handleAuthRefresh", () => {
	async function obtainSessionCookie(): Promise<string> {
		const qr = await createQrToken();
		const resp = await handleAuthExchange(exchangeRequest(qr));
		const token = cookieValue(resp.headers.get("set-cookie"));
		return `${SESSION_COOKIE_NAME}=${token}`;
	}

	it("rolls a valid session cookie forward", async () => {
		const cookie = await obtainSessionCookie();
		const resp = await handleAuthRefresh(refreshRequest(cookie));
		expect(resp.status).toBe(200);
		const newToken = cookieValue(resp.headers.get("set-cookie"));
		expect(newToken).toBeTruthy();
		expect(`${SESSION_COOKIE_NAME}=${newToken}`).not.toBe(cookie);
	});

	it("returns 401 when no cookie is present (boot with no session)", async () => {
		const resp = await handleAuthRefresh(refreshRequest());
		expect(resp.status).toBe(401);
	});

	it("returns 401 and clears the cookie for a tampered session", async () => {
		const resp = await handleAuthRefresh(refreshRequest(`${SESSION_COOKIE_NAME}=aaa.bbb.ccc`));
		expect(resp.status).toBe(401);
		expect(resp.headers.get("set-cookie")).toContain("Max-Age=0");
	});

	it("rejects a foreign Origin with 403 (CSRF guard)", async () => {
		const cookie = await obtainSessionCookie();
		const resp = await handleAuthRefresh(refreshRequest(cookie, { origin: "http://evil.example.com" }));
		expect(resp.status).toBe(403);
	});

	it("a session survives an app restart (persisted secret)", async () => {
		const cookie = await obtainSessionCookie();
		// Simulate restart: in-memory secret wiped, re-initialized from the same file.
		_resetForTests();
		await initSecret(testSecretFile);
		const resp = await handleAuthRefresh(refreshRequest(cookie));
		expect(resp.status).toBe(200);
	});

	it("a session dies when the secret file is lost (fresh secret)", async () => {
		const cookie = await obtainSessionCookie();
		_resetForTests();
		rmSync(testSecretDir, { recursive: true, force: true });
		await initSecret(testSecretFile);
		const resp = await handleAuthRefresh(refreshRequest(cookie));
		expect(resp.status).toBe(401);
	});
});

describe("handleAuthLogout", () => {
	it("revokes the rolling session chain durably and clears the cookie", async () => {
		const qr = await createQrToken();
		const exchange = await handleAuthExchange(exchangeRequest(qr));
		const token = cookieValue(exchange.headers.get("set-cookie"));
		const cookie = `${SESSION_COOKIE_NAME}=${token}`;

		const logout = await handleAuthLogout(logoutRequest(cookie));
		expect(logout.status).toBe(200);
		expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
		expect((await handleAuthRefresh(refreshRequest(cookie))).status).toBe(401);

		_resetForTests();
		await initSecret(testSecretFile);
		expect((await handleAuthRefresh(refreshRequest(cookie))).status).toBe(401);
	});
});

describe("handleArtifactDownload", () => {
	it("requires the trusted session cookie before resolving a ticket", async () => {
		const resolver = vi.fn();
		const response = await handleArtifactDownload(artifactRequest("ticket"), "ticket", resolver);
		expect(response.status).toBe(401);
		expect(resolver).not.toHaveBeenCalled();
	});

	it("streams the exact file with download headers and no base64 envelope", async () => {
		const qr = await createQrToken();
		const exchange = await handleAuthExchange(exchangeRequest(qr));
		const session = cookieValue(exchange.headers.get("set-cookie"))!;
		const cookie = `${SESSION_COOKIE_NAME}=${session}`;
		const path = join(testSecretDir, "report.zip");
		const bytes = Buffer.from("PK\u0003\u0004streamed-artifact");
		writeFileSync(path, bytes);
		const response = await handleArtifactDownload(
			artifactRequest("ticket", cookie),
			"ticket",
			() => ({ path, fileName: "报告.zip", mime: "application/zip", bytes: bytes.length }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-length")).toBe(String(bytes.length));
		expect(response.headers.get("content-type")).toBe("application/zip");
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
		expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
	});

	it("supports HEAD and rejects changed files", async () => {
		const qr = await createQrToken();
		const exchange = await handleAuthExchange(exchangeRequest(qr));
		const session = cookieValue(exchange.headers.get("set-cookie"))!;
		const cookie = `${SESSION_COOKIE_NAME}=${session}`;
		const path = join(testSecretDir, "artifact.html");
		writeFileSync(path, "hello");
		const ticket = { path, fileName: "artifact.html", mime: "text/html" as const, bytes: 5 };
		const head = await handleArtifactDownload(artifactRequest("ticket", cookie, "HEAD"), "ticket", () => ticket);
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe("5");
		expect(await head.text()).toBe("");

		writeFileSync(path, "changed");
		const changed = await handleArtifactDownload(artifactRequest("ticket", cookie), "ticket", () => ticket);
		expect(changed.status).toBe(409);
	});
});
