import { describe, expect, it } from "vitest";
import { exportReviewCount, qaMode, shotCheckTimes } from "@/lib/studio/qa-mode";
import { frameTimes } from "@/lib/media-qa";

describe("fast preview QA mode (13.37)", () => {
  it("drafts are previews, Final is full, and a plan can opt drafts into full QA", () => {
    expect(qaMode("draft")).toBe("preview");
    expect(qaMode("draft", { fullDraftQa: false })).toBe("preview");
    expect(qaMode("draft", { fullDraftQa: true })).toBe("full");
    expect(qaMode("final")).toBe("full");
  });
  it("previews skip the median-of-N export reviews; Final keeps all of them", () => {
    expect(exportReviewCount("preview", 5)).toBe(0);
    expect(exportReviewCount("full", 5)).toBe(5);
  });
  it("previews check one mid-shot frame; full QA samples the whole shot", () => {
    expect(shotCheckTimes("preview", 0, 4, frameTimes)).toEqual([2]);
    expect(shotCheckTimes("preview", 1.5, 2.25, frameTimes)).toEqual([1.875]);
    expect(shotCheckTimes("full", 0, 4, frameTimes)).toEqual(frameTimes(0, 4));
    expect(shotCheckTimes("full", 0, 4, frameTimes).length).toBeGreaterThan(1);
  });
});
