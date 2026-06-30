import type { AgentRunTraceInput, DailyBriefingTraceInput } from "./daily-briefing-tracer.js";

export type BraintrustChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type BraintrustAssistantOutput = {
  role: "assistant";
  content: string;
};

export function isBraintrustMessageList(value: unknown): value is BraintrustChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "role" in item &&
        "content" in item &&
        typeof item.content === "string",
    )
  );
}

export function isBraintrustAssistantOutput(value: unknown): value is BraintrustAssistantOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    value.role === "assistant" &&
    "content" in value &&
    typeof value.content === "string"
  );
}

export function braintrustUserMessages(...contents: string[]): BraintrustChatMessage[] {
  return contents.filter(Boolean).map((content) => ({ role: "user", content }));
}

export function braintrustAssistantOutput(content: string): BraintrustAssistantOutput {
  return { role: "assistant", content };
}

export function braintrustBriefingRequestInput(input: DailyBriefingTraceInput): BraintrustChatMessage[] {
  return braintrustUserMessages(
    `Generate a personalized daily briefing for ${input.briefingDate} using data from ${input.inputDir}. Model: ${input.model}. Max revisions: ${input.maxRevisions}. Prioritize schedule conflicts, must-include tracked entities, compliance items, and filter sports/entertainment noise.`,
  );
}

export function braintrustAgentRunInput(input: AgentRunTraceInput): BraintrustChatMessage[] {
  return braintrustUserMessages(input.prompt);
}
