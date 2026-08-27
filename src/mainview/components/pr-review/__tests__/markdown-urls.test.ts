import { describe, expect, it } from "vitest";
import { isRelativeUrl, safeLinkHref, unprotect } from "../markdown-urls";

const SMUGGLED = [
	"data:text/html,<script>alert(1)</script>",
	"vbscript:msgbox(1)",
	"file:///etc/passwd",
	"views://mainview/index.html",
	"javascript:alert(1)",
];

describe("isRelativeUrl", () => {
	it.each([
		["docs/guide.md", true],
		["./shot.png", true],
		["../assets/shot.png", true],
		["/docs/shot.png", true],
		["https://example.com/a.png", false],
		["//example.com/a.png", false],
		["data:image/png;base64,AAAA", false],
		["", false],
	])("classifies %s as a checkout path: %s", (url, expected) => {
		expect(isRelativeUrl(url)).toBe(expected);
	});
});

describe("unprotect", () => {
	it("leaves a URL it did not protect alone", () => {
		expect(unprotect("https://example.com/a")).toBe("https://example.com/a");
		expect(unprotect(undefined)).toBeUndefined();
	});

	it("refuses a token an author wrote by hand", () => {
		// The real prefix carries a per-session nonce, so any guessed one stays a
		// plain URL and never gives up the payload wrapped inside it.
		for (const guess of ["https://dev3.invalid/0/", "https://dev3.invalid/__markdown_link__/"]) {
			for (const url of SMUGGLED) {
				const forged = `${guess}${encodeURIComponent(url)}`;
				expect(unprotect(forged)).toBe(forged);
			}
		}
	});
});

describe("safeLinkHref", () => {
	it.each(SMUGGLED)("drops %s", (href) => {
		expect(safeLinkHref(href)).toBeUndefined();
	});

	it.each([
		"https://example.com/a",
		"http://example.com/a",
		"mailto:someone@example.com",
		"tel:+15550100",
		"docs/guide.md",
		"#section",
	])("keeps %s", (href) => {
		expect(safeLinkHref(href)).toBe(href);
	});
});
