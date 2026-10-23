import { afterEach, describe, expect, it } from "vitest";
import { isPinnedHookMove, isPrReviewTurnPinned, pinPrReviewTurn, releasePrReviewTurn } from "../pr-review-turn-pin";

const inPrReview = { id: "task-1", status: "review-by-colleague" as const, customColumnId: null };

describe("PR Review turn pin", () => {
	afterEach(() => releasePrReviewTurn(inPrReview.id));

	it("holds back only the moves a status hook makes", () => {
		pinPrReviewTurn(inPrReview.id);

		expect(isPinnedHookMove(inPrReview, "in-progress")).toBe(true);
		expect(isPinnedHookMove(inPrReview, "review-by-user")).toBe(true);
		expect(isPinnedHookMove(inPrReview, "user-questions")).toBe(true);
		expect(isPinnedHookMove(inPrReview, "completed")).toBe(false);
	});

	it("drops itself once the card has left PR Review", () => {
		pinPrReviewTurn(inPrReview.id);

		expect(isPrReviewTurnPinned({ ...inPrReview, status: "review-by-user" })).toBe(false);
		expect(isPrReviewTurnPinned(inPrReview)).toBe(false);
	});

	it("expires so a lost Stop cannot freeze the card", () => {
		pinPrReviewTurn(inPrReview.id, 0);

		expect(isPrReviewTurnPinned(inPrReview, 60 * 60 * 1000)).toBe(true);
		expect(isPrReviewTurnPinned(inPrReview, 3 * 60 * 60 * 1000)).toBe(false);
	});
});
