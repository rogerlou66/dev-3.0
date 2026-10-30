import { describe, expect, it } from "vitest";
import { buildChannelTitlePrefix, canaryDisplayVersion } from "../../shared/update-channel";

describe("the canary display version", () => {
	it("appends the short sha as build metadata", () => {
		expect(canaryDisplayVersion("1.42.3", "a0981f55")).toBe("1.42.3+canary.a0981f55");
	});
});

describe("the build a user is running is visible in the window title", () => {
	// The whole "which build am I on?" affordance: no chrome, no header slot, and it
	// survives browser remote mode as the tab title.
	it("marks canary and dev, and leaves stable unmarked", () => {
		expect(buildChannelTitlePrefix("canary")).toBe("[CANARY] ");
		expect(buildChannelTitlePrefix("dev")).toBe("[DEV from src] ");
		expect(
			buildChannelTitlePrefix("stable"),
			"stable must stay unmarked — a prefix every user sees forever is noise, and it is the non-default build that needs naming.",
		).toBe("");
		expect(buildChannelTitlePrefix(undefined)).toBe("");
	});
});
