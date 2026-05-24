import type { DailyBriefingValidator } from "../agent/cursor-sdk-daily-briefing-runner.js";
import type { DailyBriefingRunResult } from "../agent/types.js";
import type { ValidationIssue } from "../domain/types.js";

export class HeuristicLlmJudgeValidators implements DailyBriefingValidator {
  async validate(result: DailyBriefingRunResult): Promise<ValidationIssue[]> {
    return [
      ...knownCandidateIds(result),
      ...mustIncludeCoverage(result),
      ...unsupportedFactGuard(result),
      ...userPreferenceFit(result),
    ];
  }
}

function knownCandidateIds(result: DailyBriefingRunResult): ValidationIssue[] {
  const known = new Set(result.candidates.map((candidate) => candidate.id));
  const referenced = [
    ...result.outline.mustIncludeCandidateIds,
    ...result.outline.excludedCandidateIds.map((candidate) => candidate.id),
    ...result.outline.themes.flatMap((theme) => theme.candidateIds),
    ...result.outline.sections.flatMap((section) => section.candidateIds),
    ...result.draft.sections.flatMap((section) => section.candidateIds),
  ];
  const unknown = [...new Set(referenced.filter((candidateId) => !known.has(candidateId)))];
  return unknown.map((candidateId) => ({
    validator: "KnownCandidateIdsJudge",
    severity: "error" as const,
    message: `Candidate ${candidateId} is not in the processed candidate corpus. Use candidate_search results only.`,
    candidateIds: [candidateId],
  }));
}

function mustIncludeCoverage(result: DailyBriefingRunResult): ValidationIssue[] {
  const sectionCandidateIds = new Set(result.draft.sections.flatMap((section) => section.candidateIds));
  return result.candidates
    .filter((candidate) => candidate.mustInclude && !sectionCandidateIds.has(candidate.id))
    .map((candidate) => ({
      validator: "MustIncludeCoverageJudge",
      severity: "error" as const,
      message: `Must-include candidate ${candidate.id} is not represented in draft sections.`,
      candidateIds: [candidate.id],
    }));
}

function unsupportedFactGuard(result: DailyBriefingRunResult): ValidationIssue[] {
  const text = result.draft.finalTtsText.toLowerCase();
  const restrictedLeak = result.candidates.find((candidate) =>
    candidate.restrictedFacts.some((fact) => text.includes(fact.redactedLabel.toLowerCase())),
  );
  return restrictedLeak
    ? [
        {
          validator: "NoUnsupportedFactJudge",
          severity: "error",
          message: `Briefing appears to mention restricted fact label from ${restrictedLeak.id}.`,
          candidateIds: [restrictedLeak.id],
        },
      ]
    : [];
}

function userPreferenceFit(result: DailyBriefingRunResult): ValidationIssue[] {
  const text = result.draft.finalTtsText.toLowerCase();
  if (text.includes("lakers") || text.includes("taylor swift")) {
    return [
      {
        validator: "UserPreferenceFitJudge",
        severity: "error",
        message: "Briefing includes topics the user explicitly excludes.",
      },
    ];
  }
  return [];
}
