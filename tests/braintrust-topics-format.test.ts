import { describe, expect, it } from "vitest";
import {
  braintrustAssistantOutput,
  braintrustBriefingRequestInput,
  isBraintrustAssistantOutput,
  isBraintrustMessageList,
} from "../src/observability/braintrust-topics-format.js";

describe("braintrust topics format", () => {
  it("builds user message arrays for briefing requests", () => {
    const messages = braintrustBriefingRequestInput({
      briefingDate: "2026-05-15",
      inputDir: "inputs",
      model: "claude-4-sonnet",
      maxRevisions: 2,
    });
    expect(isBraintrustMessageList(messages)).toBe(true);
    expect(messages[0]?.content).toContain("2026-05-15");
  });

  it("builds assistant outputs", () => {
    const output = braintrustAssistantOutput("Hello briefing");
    expect(isBraintrustAssistantOutput(output)).toBe(true);
  });
});
