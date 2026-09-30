import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleIntegration } from "../commands/integration";
import { sendRequest } from "../socket-client";
import { readStdin } from "../stdin";

vi.mock("../socket-client", () => ({ sendRequest: vi.fn() }));
vi.mock("../stdin", () => ({ readStdin: vi.fn() }));

beforeEach(() => {
	vi.mocked(sendRequest).mockResolvedValue({ id: "response", ok: true, data: { protocolVersion: 1 } });
	vi.spyOn(process.stdout, "write").mockReturnValue(true);
	vi.spyOn(process.stderr, "write").mockReturnValue(true);
	vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit ${code}`); });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("integration CLI", () => {
	it("prints capability JSON without reading stdin", async () => {
		await handleIntegration("capabilities", { flags: {}, positional: [] }, "/test.sock");
		expect(sendRequest).toHaveBeenCalledWith("/test.sock", "integration.capabilities", {});
		expect(process.stdout.write).toHaveBeenCalledWith('{"protocolVersion":1}\n');
		expect(readStdin).not.toHaveBeenCalled();
	});
	it.each(["create", "launch", "show", "events"])("passes %s JSON through without shell interpretation", async (command) => {
		const params = { description: "Quotes ' and `commands` and $(text)\nSecond line" };
		vi.mocked(readStdin).mockResolvedValue(JSON.stringify(params));
		await handleIntegration(command, { flags: { json: "-" }, positional: [] }, "/test.sock");
		expect(sendRequest).toHaveBeenCalledWith("/test.sock", `integration.${command}`, params);
	});
	it.each(["[]", "null", "not json"])("rejects non-object input %s", async (raw) => {
		vi.mocked(readStdin).mockResolvedValue(raw);
		await expect(handleIntegration("create", { flags: { json: "-" }, positional: [] }, "/test.sock")).rejects.toThrow("exit");
		expect(sendRequest).not.toHaveBeenCalled();
	});
	it("requires stdin explicitly before mutations", async () => {
		await expect(handleIntegration("launch", { flags: {}, positional: [] }, "/test.sock")).rejects.toThrow("exit");
		expect(readStdin).not.toHaveBeenCalled();
	});
	it("does not treat an old server as a successful capability probe", async () => {
		vi.mocked(sendRequest).mockResolvedValue({ id: "response", ok: false, error: "Unknown method: integration.capabilities" });
		await expect(handleIntegration("capabilities", { flags: {}, positional: [] }, "/test.sock")).rejects.toThrow("exit");
		expect(process.stdout.write).not.toHaveBeenCalled();
	});
});
