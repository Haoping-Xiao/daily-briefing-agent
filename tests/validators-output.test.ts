import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DailyBriefingRunResult } from "../src/agent/types.js";
import { buildBriefingMetadata, estimateDurationSeconds, materializeFinalTtsText, wordCount } from "../src/output/metadata-builder.js";
import { writeBriefingOutputs } from "../src/output/output-writer.js";
import { RuleValidators } from "../src/validators/rule-validators.js";
import { HeuristicLlmJudgeValidators } from "../src/validators/llm-judge-validators.js";

describe("RuleValidators", () => {
  it("rejects markdown, URLs, emails, symbolic numbers, private details, and repeated opening", async () => {
    const result = fakeResult("Good morning\n# Today call jordan@example.com at https://example.com about $4B, PSD3, and medical details.");

    const issues = await new RuleValidators().validate(result);

    expect(issues.map((issue) => issue.validator)).toEqual(
      expect.arrayContaining([
        "NoMarkdownValidationRule",
        "NoUrlOrEmailValidationRule",
        "SpokenNumberValidationRule",
        "PrivacyLeakValidationRule",
        "OpeningVariationValidationRule",
      ]),
    );
  });

  it("accepts a spoken English briefing in the target duration range", async () => {
    const text = Array.from({ length: 165 }, (_, index) => `word${index}`).join(" ").replace(/\d/g, "x");
    const result = fakeResult(text);

    expect(await new RuleValidators().validate(result)).toEqual([]);
  });
});

describe("HeuristicLlmJudgeValidators", () => {
  it("requires must-include candidates to appear in draft sections", async () => {
    const result = fakeResult("This is a long enough briefing ".repeat(35));
    result.draft.sections[0].candidateIds = [];

    const issues = await new HeuristicLlmJudgeValidators().validate(result);

    expect(issues.map((issue) => issue.validator)).toContain("MustIncludeCoverageJudge");
  });

  it("rejects candidate ids outside the processed candidate corpus", async () => {
    const result = fakeResult("This is a long enough briefing ".repeat(35));
    result.draft.sections[0].candidateIds = ["news_999"];

    const issues = await new HeuristicLlmJudgeValidators().validate(result);

    expect(issues.map((issue) => issue.validator)).toContain("KnownCandidateIdsJudge");
  });
});

describe("metadata builder and output writer", () => {
  it("computes word count, duration, coverage, and section ranges", () => {
    const result = fakeResult("Opening text. Second section text.");
    result.candidates.push({
      id: "em_009",
      sourceType: "email",
      title: "Plaid",
      topicTags: ["vendor_plaid"],
      score: { value: 80, reasons: [{ source: "rule", label: "boost_plaid", reason: "Plaid needs action.", delta: 30 }] },
      mustInclude: false,
      filterReasons: [],
      modelJudgments: [],
      speakableFacts: [{ raw: "Plaid", spoken: "Plaid needs action." }],
      restrictedFacts: [],
      originalItemIds: ["em_009"],
    });
    result.draft.sections = [
      { sectionId: "opening", title: "Opening", text: "Opening text.", candidateIds: ["news_001"] },
      { sectionId: "second", title: "Second", text: "Second section text.", candidateIds: ["em_009"] },
    ];
    result.outline.sections = [
      {
        id: "opening",
        name: "Opening",
        candidateIds: ["news_001"],
        coveredInputItemIds: { calendar: [], emails: [], news: ["news_001"] },
        targetWords: 10,
      },
      {
        id: "second",
        name: "Second",
        candidateIds: ["em_009"],
        coveredInputItemIds: { calendar: [], emails: ["em_009"], news: [] },
        targetWords: 10,
      },
    ];

    const metadata = buildBriefingMetadata(result);

    expect(metadata.included).toEqual({ calendar: [], emails: ["em_009"], news: ["news_001"] });
    expect(materializeFinalTtsText(result)).toBe("Opening text.\n\nSecond section text.");
    expect(metadata.sections[1]).toEqual(expect.objectContaining({ startLine: 3, endLine: 3 }));
    expect(metadata.mustIncludeCoverage[0]).toEqual(expect.objectContaining({ candidateId: "news_001", covered: true }));
  });

  it("derives included input ids from selected candidates when agent omits covered ids", () => {
    const result = fakeResult("Opening text. Schedule text.");
    result.candidates.push({
      id: "calendar_conflict_cal_006_cal_007",
      sourceType: "calendar",
      title: "Schedule conflict",
      topicTags: ["schedule_conflict"],
      score: { value: 100, reasons: [{ source: "rule", label: "calendar_overlap", reason: "Calendar conflict.", delta: 90 }] },
      mustInclude: true,
      filterReasons: [],
      modelJudgments: [],
      speakableFacts: [{ raw: "Conflict", spoken: "Schedule conflict." }],
      restrictedFacts: [],
      originalItemIds: ["cal_006", "cal_007"],
    });
    result.outline.sections = [
      {
        id: "opening",
        name: "Opening",
        candidateIds: ["news_001", "calendar_conflict_cal_006_cal_007"],
        coveredInputItemIds: { calendar: [], emails: [], news: [] },
        targetWords: 20,
      },
    ];
    result.draft.sections = [
      {
        sectionId: "opening",
        title: "Opening",
        text: "Opening text. Schedule text.",
        candidateIds: ["news_001", "calendar_conflict_cal_006_cal_007"],
      },
    ];

    const metadata = buildBriefingMetadata(result);

    expect(metadata.included).toEqual({ calendar: ["cal_006", "cal_007"], emails: [], news: ["news_001"] });
  });

  it("writes briefing text and metadata JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "briefing-output-"));
    const textPath = join(dir, "briefing.txt");
    const jsonPath = join(dir, "briefing.json");

    const result = fakeResult("Opening text. Second section text.");
    result.draft.sections = [
      { sectionId: "opening", title: "Opening", text: "Opening text.", candidateIds: ["news_001"] },
      { sectionId: "second", title: "Second", text: "Second section text.", candidateIds: [] },
    ];

    await writeBriefingOutputs(result, { textPath, jsonPath });

    expect(await readFile(textPath, "utf8")).toBe("Opening text.\n\nSecond section text.\n");
    expect(JSON.parse(await readFile(jsonPath, "utf8")).durationMethod).toBe(
      "Estimated from English word count at 130 words per minute.",
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("uses the standard duration estimate", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(estimateDurationSeconds(130)).toBe(60);
  });
});

function fakeResult(text: string): DailyBriefingRunResult {
  return {
    candidates: [
      {
        id: "news_001",
        sourceType: "news",
        title: "Cobalt",
        topicTags: ["company_launch"],
        score: { value: 100, reasons: [{ source: "rule", label: "boost_cobalt", reason: "Cobalt is must include.", delta: 50 }] },
        mustInclude: true,
        filterReasons: [],
        modelJudgments: [],
        speakableFacts: [{ raw: "Cobalt", spoken: "Cobalt launched." }],
        restrictedFacts: [],
        originalItemIds: ["news_001"],
      },
    ],
    sourceResults: {
      calendar: { candidates: [], discarded: [] },
      email: { candidates: [], discarded: [] },
      news: { candidates: [], discarded: [] },
    },
    validationIssues: [],
    outline: {
      themes: [],
      sections: [
        {
          id: "opening",
          name: "Opening",
          candidateIds: ["news_001"],
          coveredInputItemIds: { calendar: [], emails: [], news: ["news_001"] },
          targetWords: 20,
        },
      ],
      mustIncludeCandidateIds: ["news_001"],
      excludedCandidateIds: [],
      discardedInputItems: [],
      explorationReasoning: [],
    },
    draft: {
      sections: [{ sectionId: "opening", title: "Opening", text, candidateIds: ["news_001"] }],
      fullTextWithSectionMarkers: `## Opening\n${text}`,
      finalTtsText: text,
    },
  };
}
