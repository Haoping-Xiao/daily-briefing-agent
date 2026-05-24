import { describe, expect, it } from "vitest";
import type { EmailBriefingItem, SourcePolicy } from "../src/domain/types.js";
import { createSourceRuntime } from "../src/pipeline/source-runtime.js";
import { processItems } from "../src/processors/source-processor.js";

describe("source processors", () => {
  it("detects the Maya and customer interview calendar conflict as must-include", async () => {
    const runtime = await createSourceRuntime("inputs");
    const result = await runtime.runTool("calendar");

    const conflict = result.candidates.find((candidate) => candidate.id === "calendar_conflict_cal_006_cal_007");
    expect(conflict).toMatchObject({
      mustInclude: true,
      originalItemIds: ["cal_006", "cal_007"],
    });
    expect(conflict?.topicTags).toContain("schedule_conflict");
    expect(conflict?.score.reasons[0].label).toBe("calendar_overlap");
  });

  it("keeps private and medical details out of speakable facts", async () => {
    const runtime = await createSourceRuntime("inputs");
    const calendar = await runtime.runTool("calendar");
    const email = await runtime.runTool("email");

    const privateAppointment = calendar.candidates.find((candidate) => candidate.id === "cal_011");
    const medicalEmail = email.candidates.find((candidate) => candidate.id === "em_020");
    expect(privateAppointment?.restrictedFacts[0].redactedLabel).toBe("private calendar details");
    expect(privateAppointment?.speakableFacts[0].spoken).not.toContain("Marked private");
    expect(medicalEmail?.restrictedFacts[0].redactedLabel).toBe("medical appointment details");
    expect(medicalEmail?.speakableFacts[0].spoken).not.toContain("Sutter");
  });

  it("applies source privacy rules beyond hard-coded fact builders", () => {
    const privateEmail: EmailBriefingItem = {
      id: "em_private",
      sourceType: "email",
      title: "Private bank transfer details",
      summary: "Contains sensitive family account context.",
      from: { name: "Bank", email: "bank@example.com" },
      to: ["jordan@cobaltlabs.com"],
      receivedAt: "2026-05-15T06:00:00-07:00",
      labels: ["primary", "private"],
      provenance: { sourceName: "emails", originalId: "em_private", origin: "file" },
    };
    const policy: SourcePolicy = {
      sourceType: "email",
      operations: [
        {
          type: "privacy",
          id: "private_label",
          when: { field: "labels", op: "intersects", values: ["private"] },
          redactedLabel: "private email details",
          reason: "Private labeled email details must not be spoken.",
          spokenReplacement: "There is a private email that needs discretion.",
        },
      ],
    };

    const result = processItems([privateEmail], policy);

    expect(result.candidates[0].restrictedFacts).toEqual([
      { redactedLabel: "private email details", reason: "Private labeled email details must not be spoken." },
    ]);
    expect(result.candidates[0].modelJudgments).toEqual([]);
    expect(result.candidates[0].speakableFacts).toEqual([
      { raw: "Private bank transfer details. Contains sensitive family account context.", spoken: "There is a private email that needs discretion." },
    ]);
  });

  it("boosts action-required Plaid and PSD3 emails", async () => {
    const runtime = await createSourceRuntime("inputs");
    const result = await runtime.runTool("email");

    const plaid = result.candidates.find((candidate) => candidate.id === "em_009");
    const psd3 = result.candidates.find((candidate) => candidate.id === "em_011");
    expect(plaid?.mustInclude).toBe(true);
    expect(plaid?.topicTags).toContain("vendor_plaid");
    expect(plaid?.score.reasons.map((reason) => reason.label)).toEqual(expect.arrayContaining(["boost_action_required", "boost_plaid"]));
    expect(psd3?.topicTags).toContain("psd3");
  });

  it("drops sports, entertainment, and daily crypto price movement while preserving crypto enforcement", async () => {
    const runtime = await createSourceRuntime("inputs");
    const result = await runtime.runTool("news");

    expect(result.discarded.map((item) => item.id)).toEqual(expect.arrayContaining(["news_006", "news_007", "news_008", "news_019", "news_029"]));
    expect(result.candidates.find((candidate) => candidate.id === "news_009")?.topicTags).toContain("fintech_regulation");
  });

  it("leaves model judgments empty until the source model enhancer runs", async () => {
    const runtime = await createSourceRuntime("inputs");
    const email = await runtime.runTool("email");
    const news = await runtime.runTool("news");

    expect(email.candidates.find((candidate) => candidate.id === "em_019")?.modelJudgments).toEqual([]);
    expect(news.candidates.find((candidate) => candidate.id === "news_016")?.modelJudgments).toEqual([]);
  });

  it("returns self-contained serialized candidate scores and spoken numeric facts", async () => {
    const runtime = await createSourceRuntime("inputs");
    const result = await runtime.runTool("news");

    const cobalt = result.candidates.find((candidate) => candidate.id === "news_001");
    expect(cobalt?.mustInclude).toBe(true);
    expect(cobalt?.topicTags).toContain("company_launch");
    expect(cobalt?.score).toEqual(
      expect.objectContaining({
        value: expect.any(Number),
        reasons: expect.arrayContaining([expect.objectContaining({ source: "rule", label: "boost_cobalt" })]),
      }),
    );
    expect(cobalt?.speakableFacts[0].spoken).toContain("four billion dollars");
  });

  it("does not force every Cobalt mention or accidental AI substring into must-include", async () => {
    const runtime = await createSourceRuntime("inputs");
    const email = await runtime.runTool("email");
    const news = await runtime.runTool("news");

    expect(email.candidates.find((candidate) => candidate.id === "em_010")?.mustInclude).toBe(false);
    expect(news.candidates.find((candidate) => candidate.id === "news_002")?.topicTags).not.toContain("ai_product");
    expect(news.candidates.find((candidate) => candidate.id === "news_002")?.score.reasons.map((reason) => reason.label)).not.toContain(
      "boost_ai_product",
    );
    expect(news.candidates.find((candidate) => candidate.id === "news_002")?.speakableFacts[0].spoken).toContain("PSD three");
  });
});
