import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// Same isolation as remote-state.test.ts: the real fs is exercised, but never the
// developer's actual ~/.dev3.0.
const TEST_HOME = vi.hoisted(() => {
	const base = (process.env.TMPDIR || process.env.TMP || "/tmp").replace(/\/$/, "");
	return `${base}/dev3-tunnel-host-test-${process.pid}`;
});
vi.mock("../paths", () => ({ DEV3_HOME: TEST_HOME }));

vi.mock("../logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { TUNNEL_HOSTS_FILE, customTunnelHostIsStable, recordCustomTunnelUrl } from "../tunnel-host-memory";

const COMMAND = "tunnel create {port} --name dev3";
const URL = "https://box-dev3.tunnel.example.com";

beforeEach(() => {
	rmSync(TEST_HOME, { recursive: true, force: true });
	mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("custom tunnel hostname stability", () => {
	it("does not call a hostname stable the first time it is seen", () => {
		expect(recordCustomTunnelUrl(COMMAND, URL)).toBe(false);
		expect(customTunnelHostIsStable(COMMAND)).toBe(false);
	});

	it("proves stability when the same command yields the same URL again", () => {
		recordCustomTunnelUrl(COMMAND, URL);
		expect(recordCustomTunnelUrl(COMMAND, URL)).toBe(true);
		expect(customTunnelHostIsStable(COMMAND)).toBe(true);
	});

	it("revokes the proof as soon as the hostname rotates", () => {
		recordCustomTunnelUrl(COMMAND, URL);
		recordCustomTunnelUrl(COMMAND, URL);
		expect(recordCustomTunnelUrl(COMMAND, "https://box-a1b2.tunnel.example.com")).toBe(false);
		expect(customTunnelHostIsStable(COMMAND)).toBe(false);
	});

	it("does not carry one command's stability over to another", () => {
		recordCustomTunnelUrl(COMMAND, URL);
		recordCustomTunnelUrl(COMMAND, URL);
		expect(customTunnelHostIsStable("ngrok http {port} --log stdout")).toBe(false);
	});

	it("re-learns from scratch after the command changes back", () => {
		recordCustomTunnelUrl(COMMAND, URL);
		recordCustomTunnelUrl("ngrok http {port}", "https://a1b2.ngrok-free.app");
		expect(recordCustomTunnelUrl(COMMAND, URL)).toBe(false);
	});

	it("treats a corrupt or half-written file as nothing learned", () => {
		mkdirSync(`${TEST_HOME}/remote`, { recursive: true });
		writeFileSync(TUNNEL_HOSTS_FILE, "{not json");
		expect(customTunnelHostIsStable(COMMAND)).toBe(false);
		expect(recordCustomTunnelUrl(COMMAND, URL)).toBe(false);
		expect(JSON.parse(readFileSync(TUNNEL_HOSTS_FILE, "utf-8"))).toEqual({
			command: COMMAND,
			url: URL,
			stable: false,
		});
	});

	it("creates the remote dir on first write", () => {
		expect(recordCustomTunnelUrl(COMMAND, URL)).toBe(false);
		expect(JSON.parse(readFileSync(TUNNEL_HOSTS_FILE, "utf-8")).url).toBe(URL);
	});
});
