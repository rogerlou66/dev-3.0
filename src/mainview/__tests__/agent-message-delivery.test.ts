import { describe, expect, it } from "vitest";
import { requireDeliveredAgentMessage } from "../agent-message-delivery";

describe("requireDeliveredAgentMessage", () => {
	it("returns confirmed deliveries", () => {
		expect(requireDeliveredAgentMessage({ status: "delivered", spilledPath: null })).toEqual({
			status: "delivered",
			spilledPath: null,
		});
	});

	it.each(["unconfirmed", "not-delivered"] as const)("rejects %s without clearing user text", (status) => {
		expect(() => requireDeliveredAgentMessage({ status, spilledPath: null })).toThrow(status);
	});
});
