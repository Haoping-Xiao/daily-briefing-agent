import { describe, expect, it } from "vitest";
import { buildInitialPrompt, buildRevisionPrompt } from "../src/agent/prompts.js";
import type { BriefGenerationContext } from "../src/domain/types.js";

const context: BriefGenerationContext = {
  toneRules: [],
  interestRules: [],
  exclusionRules: [],
  trackedEntityRules: [],
  targetDurationSeconds: 75,
  minDurationSeconds: 60,
  maxDurationSeconds: 90,
};

describe("agent prompts", () => {
  it("includes the weekday with the briefing date in the initial prompt", () => {
    const prompt = buildInitialPrompt({
      briefingDate: "2026-05-15",
      inputDir: "inputs",
      context,
      candidates: [],
    });

    expect(prompt).toContain("Briefing date: 2026-05-15 (Friday)");
  });

  it("keeps the briefing date and weekday in revision prompts", () => {
    const prompt = buildRevisionPrompt({
      briefingDate: "2026-05-15",
      validationIssues: [{ validator: "DurationValidationRule", severity: "error", message: "Too long." }],
      candidates: [],
    });

    expect(prompt).toContain("Briefing date: 2026-05-15 (Friday)");
  });
});
