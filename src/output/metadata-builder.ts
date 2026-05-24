import type { DailyBriefingRunResult } from "../agent/types.js";
import type { BriefingMetadata, BriefingSectionMetadata } from "../domain/types.js";

const WORDS_PER_MINUTE = 130;

export function buildBriefingMetadata(result: DailyBriefingRunResult): BriefingMetadata {
  const text = materializeFinalTtsText(result);
  const sections = buildSectionMetadata(result);
  const included = collectIncluded(result);
  const count = wordCount(text);
  return {
    included,
    discarded: result.outline.discardedInputItems,
    sections,
    wordCount: count,
    estimatedDurationSeconds: estimateDurationSeconds(count),
    durationMethod: "Estimated from English word count at 130 words per minute.",
    mustIncludeCoverage: result.candidates
      .filter((candidate) => candidate.mustInclude)
      .map((candidate) => ({
        candidateId: candidate.id,
        covered: result.outline.mustIncludeCandidateIds.includes(candidate.id) || sections.some((section) => section.candidateIds.includes(candidate.id)),
        reason: candidate.score.reasons.map((scoreReason) => scoreReason.reason).join(" "),
      })),
  };
}

export function materializeFinalTtsText(result: DailyBriefingRunResult): string {
  const sectionTexts = result.draft.sections.map((section) => section.text.trim()).filter(Boolean);
  if (sectionTexts.length > 0) {
    return sectionTexts.join("\n\n");
  }
  return result.draft.finalTtsText.trim();
}

export function wordCount(text: string): number {
  const matches = text.trim().match(/[A-Za-z]+(?:'[A-Za-z]+)?/g);
  return matches?.length ?? 0;
}

export function estimateDurationSeconds(words: number): number {
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}

function collectIncluded(result: DailyBriefingRunResult): BriefingMetadata["included"] {
  const included = {
    calendar: new Set<string>(),
    emails: new Set<string>(),
    news: new Set<string>(),
  };
  const candidatesById = new Map(result.candidates.map((candidate) => [candidate.id, candidate]));

  for (const section of result.outline.sections) {
    section.coveredInputItemIds.calendar.forEach((id) => included.calendar.add(id));
    section.coveredInputItemIds.emails.forEach((id) => included.emails.add(id));
    section.coveredInputItemIds.news.forEach((id) => included.news.add(id));
    section.candidateIds.forEach((candidateId) => addCandidateInputIds(candidateId, candidatesById, included));
  }

  for (const section of result.draft.sections) {
    section.candidateIds.forEach((candidateId) => addCandidateInputIds(candidateId, candidatesById, included));
  }

  return {
    calendar: [...included.calendar],
    emails: [...included.emails],
    news: [...included.news],
  };
}

function addCandidateInputIds(
  candidateId: string,
  candidatesById: Map<string, DailyBriefingRunResult["candidates"][number]>,
  included: { calendar: Set<string>; emails: Set<string>; news: Set<string> },
): void {
  const candidate = candidatesById.get(candidateId);
  if (!candidate) return;
  const ids = candidate.originalItemIds.length > 0 ? candidate.originalItemIds : [candidate.id];
  if (candidate.sourceType === "calendar") {
    ids.forEach((id) => included.calendar.add(id));
    return;
  }
  if (candidate.sourceType === "email") {
    ids.forEach((id) => included.emails.add(id));
    return;
  }
  ids.forEach((id) => included.news.add(id));
}

function buildSectionMetadata(result: DailyBriefingRunResult): BriefingSectionMetadata[] {
  let searchStart = 0;
  return result.draft.sections.map((draftSection) => {
    const outlineSection = result.outline.sections.find((section) => section.id === draftSection.sectionId);
    const finalText = materializeFinalTtsText(result);
    const foundAt = finalText.indexOf(draftSection.text, searchStart);
    const startChar = foundAt >= 0 ? foundAt : searchStart;
    const endChar = startChar + draftSection.text.length;
    searchStart = endChar;
    const { startLine, endLine } = lineRange(finalText, startChar, endChar);
    return {
      id: draftSection.sectionId,
      name: outlineSection?.name ?? draftSection.title,
      candidateIds: draftSection.candidateIds,
      startChar,
      endChar,
      startLine,
      endLine,
    };
  });
}

function lineRange(text: string, startChar: number, endChar: number): { startLine: number; endLine: number } {
  const beforeStart = text.slice(0, startChar);
  const beforeEnd = text.slice(0, endChar);
  return {
    startLine: beforeStart.split("\n").length,
    endLine: beforeEnd.split("\n").length,
  };
}
