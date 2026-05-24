import type { BriefGenerationContext, RankedSourceCandidate, ValidationIssue } from "../domain/types.js";

export function buildInitialPrompt(input: {
  briefingDate: string;
  inputDir: string;
  context: BriefGenerationContext;
  candidates: RankedSourceCandidate[];
}): string {
  return [
    "You are the Daily Briefing Agent.",
    "",
    "Before drafting, you MUST call candidate_search with query \"*\" and topK around 12 to inspect the top ranked candidates.",
    "Then use candidate_search with different keywords when needed to explore related items, deduplicate themes, and find must-include material.",
    "Use returned candidate data as the filtered, scored, privacy-reviewed priority list.",
    "Do not search or read the input data directory as source evidence; candidate_search is the candidate evidence surface.",
    "Do not use grep, read, glob, shell, or workspace files as source evidence even if those tools are available.",
    "Do not use unrelated files as source evidence. Do not invent facts. Do not speak restrictedFacts.",
    "Use speakableFacts.spoken as the factual source for the final TTS text.",
    "Write natural chief-of-staff prose; do not mechanically concatenate candidate titles or summaries.",
    "Use candidate_search when needed to connect related items or avoid repeating the same event across sources.",
    "Avoid meta-source phrasing like 'mentions', 'includes', 'digest', 'third paragraph', or 'ACTION REQUIRED' unless it is the user-facing point.",
    "Search results have already been filtered, scored, and privacy-reviewed by source processing.",
    "Use modelJudgments as already-computed relevance, value, and privacy evidence; do not re-run source filtering or ranking while drafting.",
    "If matchedRestrictedFacts is true, the query matched private evidence; use only returned speakableFacts and never infer or reveal private details.",
    "",
    `Briefing date: ${formatBriefingDate(input.briefingDate)}`,
    `Candidate corpus size: ${input.candidates.length}`,
    "",
    "Generation context JSON:",
    JSON.stringify(input.context, null, 2),
    "",
    "Return only valid JSON with this shape:",
    JSON.stringify(
      {
        outline: {
          themes: [],
          sections: [],
          mustIncludeCandidateIds: [],
          excludedCandidateIds: [],
          discardedInputItems: [],
          explorationReasoning: [],
        },
        draft: {
          sections: [],
          fullTextWithSectionMarkers: "",
          finalTtsText: "",
        },
      },
      null,
      2,
    ),
  ].join("\n");
}

export function buildRevisionPrompt(input: {
  briefingDate: string;
  validationIssues: ValidationIssue[];
  candidates: RankedSourceCandidate[];
}): string {
  return [
    "Revise the briefing JSON to fix these validation issues.",
    "Keep the same JSON shape. Do not add unsupported facts. Use candidate_search again if you need candidate evidence.",
    "Use candidate speakableFacts as the factual source.",
    "Keep the revision natural and brief; do not mechanically concatenate candidate titles or summaries.",
    "Avoid repeating the same event across sources.",
    "Do not reveal restrictedFacts.",
    "",
    `Briefing date: ${formatBriefingDate(input.briefingDate)}`,
    "",
    "Validation issues:",
    JSON.stringify(input.validationIssues, null, 2),
    "",
    `Candidate corpus size: ${input.candidates.length}`,
  ].join("\n");
}

function formatBriefingDate(briefingDate: string): string {
  const date = new Date(`${briefingDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return briefingDate;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
  return `${briefingDate} (${weekday})`;
}
