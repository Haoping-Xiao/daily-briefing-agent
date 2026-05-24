import { describe, expect, it } from "vitest";
import { parseAgentRunPayload } from "../src/agent/result-parser.js";

describe("parseAgentRunPayload", () => {
  it("normalizes common loose agent JSON into the strict payload contract", () => {
    const payload = parseAgentRunPayload(
      JSON.stringify({
        outline: {
          themes: ["Cobalt launch", "PSD3"],
          sections: [
            { title: "Opening", candidateIds: ["news_001"] },
            { title: "Schedule", candidateIds: ["calendar_conflict_cal_006_cal_007"] },
          ],
          mustIncludeCandidateIds: ["news_001"],
          excludedCandidateIds: ["news_006"],
          discardedInputItems: ["em_004", "news_006"],
          explorationReasoning: ["Grouped cross-source themes."],
        },
        draft: {
          sections: [
            { title: "Opening", text: "Cobalt launched.", candidateIds: ["news_001"] },
            { title: "Schedule", text: "There is a schedule conflict.", candidateIds: ["calendar_conflict_cal_006_cal_007"] },
          ],
          fullText: "Opening\nCobalt launched.",
          finalText: "Cobalt launched. There is a schedule conflict.",
        },
      }),
    );

    expect(payload.outline.themes[0]).toEqual({
      id: "cobalt-launch",
      topicTags: [],
      candidateIds: [],
      reason: "Cobalt launch",
    });
    expect(payload.outline.sections[0]).toEqual(
      expect.objectContaining({
        id: "opening",
        name: "Opening",
        coveredInputItemIds: { calendar: [], emails: [], news: [] },
        targetWords: 0,
      }),
    );
    expect(payload.outline.excludedCandidateIds[0]).toEqual({ id: "news_006", reason: "Excluded by agent." });
    expect(payload.outline.discardedInputItems[0]).toEqual({ id: "em_004", sourceType: "email", reason: "Discarded by agent." });
    expect(payload.draft.sections[0].sectionId).toBe("opening");
    expect(payload.draft.finalTtsText).toContain("schedule conflict");
  });
});
