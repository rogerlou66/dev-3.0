import { beforeEach, describe, expect, it } from "vitest";
import {
	_resetAntigravityConversationsForTests,
	classifyAntigravityConversation as classify,
} from "../cli-socket/antigravity-conversations";

beforeEach(() => { _resetAntigravityConversationsForTests(); });

describe("classifyAntigravityConversation", () => {
	it("treats the first conversation an agy process reports as the main one", () => {
		expect(classify("t:1", "main", "SessionStart")).toBe("main");
		expect(classify("t:1", "main", "UserPromptSubmit")).toBe("main");
		expect(classify("t:1", "main", "Stop")).toBe("main");
	});

	it("flags a conversation that starts while the main one is mid-turn as a subagent (observed order on agy 1.4.5)", () => {
		classify("t:1", "main", "SessionStart");
		classify("t:1", "main", "UserPromptSubmit");
		expect(classify("t:1", "sub", "SessionStart")).toBe("subagent");
		expect(classify("t:1", "sub", "UserPromptSubmit")).toBe("subagent");
		expect(classify("t:1", "sub", "Stop")).toBe("subagent");
		expect(classify("t:1", "main", "UserPromptSubmit")).toBe("main");
		expect(classify("t:1", "main", "Stop")).toBe("main");
	});

	it("adopts a new conversation started while the main one is idle (/new)", () => {
		classify("t:1", "main", "SessionStart");
		classify("t:1", "main", "UserPromptSubmit");
		classify("t:1", "main", "Stop");
		expect(classify("t:1", "fresh", "SessionStart")).toBe("main");
		classify("t:1", "fresh", "UserPromptSubmit");
		expect(classify("t:1", "main", "UserPromptSubmit")).toBe("subagent");
	});

	it("keeps agy processes apart, so a relaunch starts clean", () => {
		classify("t:1", "main", "UserPromptSubmit");
		expect(classify("t:2", "resumed", "UserPromptSubmit")).toBe("main");
	});
});
