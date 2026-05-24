import { z } from "zod";
import { CursorSdkAgentClient } from "../agent/cursor-sdk-agent-client.js";
import { createSourceRuntime } from "../pipeline/source-runtime.js";
import type { ModelOperationJudgment, RankedSourceCandidate } from "../domain/types.js";
import { CursorSdkModelOperationEnhancer } from "../model/model-operation-enhancer.js";

export const CandidateSearchToolInputSchema = z.object({
  briefingDate: z.string(),
  query: z.string().trim().min(1),
  topK: z.number().int().positive().max(50).optional().default(10),
});

export type CandidateSearchToolInput = z.infer<typeof CandidateSearchToolInputSchema>;

export interface CandidateSearchToolResult {
  query: string;
  topK: number;
  totalCandidateCount: number;
  matchCount: number;
  results: SearchableCandidate[];
}

export type SearchableCandidate = Omit<RankedSourceCandidate, "restrictedFacts" | "modelJudgments"> & {
  modelJudgments: Array<Omit<ModelOperationJudgment, "restrictedFacts">>;
  matchedRestrictedFacts: boolean;
  matchScore: number;
};

const candidateCache = new Map<string, Promise<RankedSourceCandidate[]>>();

export async function runCandidateSearchTool(inputDir: string, input: unknown): Promise<CandidateSearchToolResult> {
  const parsed = CandidateSearchToolInputSchema.parse(input);
  const candidates = await loadCachedCandidates(inputDir);
  const matches = searchCandidates(candidates, parsed.query);
  const results = matches.slice(0, parsed.topK);
  return {
    query: parsed.query,
    topK: parsed.topK,
    totalCandidateCount: candidates.length,
    matchCount: matches.length,
    results,
  };
}

async function loadCachedCandidates(inputDir: string): Promise<RankedSourceCandidate[]> {
  const serializedCorpus = process.env.DAILY_BRIEFING_CANDIDATES_JSON;
  if (serializedCorpus) return JSON.parse(serializedCorpus) as RankedSourceCandidate[];

  const cacheKey = JSON.stringify({
    inputDir,
    modelOpsEnabled: process.env.DAILY_BRIEFING_MODEL_OPS_ENABLED === "true",
    model: process.env.DAILY_BRIEFING_MODEL?.trim() ?? "",
  });
  const existing = candidateCache.get(cacheKey);
  if (existing) return existing;

  const candidatesPromise = createSourceRuntime(inputDir, {
    modelOperationEnhancer: modelOperationEnhancerFromEnv(),
  }).then((runtime) => runtime.runAllTools()).then((sourceResults) => Object.values(sourceResults).flatMap((result) => result.candidates));
  candidateCache.set(cacheKey, candidatesPromise);
  return candidatesPromise;
}

export function searchCandidates(candidates: RankedSourceCandidate[], query: string): SearchableCandidate[] {
  if (query.trim() === "*") {
    return rankCandidates(candidates).map((candidate) => sanitizeCandidate(candidate, false, 0));
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  return candidates
    .map((candidate) => {
      const publicText = publicSearchText(candidate);
      const restrictedText = candidate.restrictedFacts.map((fact) => `${fact.redactedLabel} ${fact.reason}`).join(" ").toLowerCase();
      const publicScore = scoreText(publicText, terms);
      const restrictedScore = scoreText(restrictedText, terms);
      return {
        candidate,
        matchedRestrictedFacts: restrictedScore > 0,
        matchScore: publicScore + restrictedScore,
      };
    })
    .filter((match) => match.matchScore > 0)
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        Number(b.candidate.mustInclude) - Number(a.candidate.mustInclude) ||
        b.candidate.score.value - a.candidate.score.value,
    )
    .map(({ candidate, matchedRestrictedFacts, matchScore }) => sanitizeCandidate(candidate, matchedRestrictedFacts, matchScore));
}

function rankCandidates(candidates: RankedSourceCandidate[]): RankedSourceCandidate[] {
  return [...candidates].sort((a, b) => Number(b.mustInclude) - Number(a.mustInclude) || b.score.value - a.score.value);
}

function modelOperationEnhancerFromEnv() {
  if (process.env.DAILY_BRIEFING_MODEL_OPS_ENABLED !== "true") return undefined;
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  const model = process.env.DAILY_BRIEFING_MODEL?.trim();
  const cwd = process.env.DAILY_BRIEFING_CWD?.trim() ?? process.cwd();
  if (!apiKey || !model) return undefined;
  return new CursorSdkModelOperationEnhancer(new CursorSdkAgentClient(), {
    apiKey,
    model,
    cwd,
  });
}

function publicSearchText(candidate: RankedSourceCandidate): string {
  return [
    candidate.id,
    candidate.sourceType,
    candidate.title,
    candidate.topicTags.join(" "),
    candidate.score.reasons.map((reason) => `${reason.label} ${reason.reason}`).join(" "),
    candidate.filterReasons.join(" "),
    candidate.modelJudgments.map((judgment) => `${judgment.schema} ${judgment.reason}`).join(" "),
    candidate.speakableFacts.map((fact) => `${fact.raw} ${fact.spoken}`).join(" "),
    candidate.originalItemIds.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function scoreText(text: string, terms: string[]): number {
  return terms.reduce((score, term) => (text.includes(term) ? score + 1 : score), 0);
}

function sanitizeCandidate(candidate: RankedSourceCandidate, matchedRestrictedFacts: boolean, matchScore: number): SearchableCandidate {
  const { restrictedFacts: _restrictedFacts, modelJudgments, ...publicCandidate } = candidate;
  return {
    ...publicCandidate,
    modelJudgments: modelJudgments.map(stripRestrictedJudgmentFacts),
    matchedRestrictedFacts,
    matchScore,
  };
}

function stripRestrictedJudgmentFacts(judgment: ModelOperationJudgment): Omit<ModelOperationJudgment, "restrictedFacts"> {
  const { restrictedFacts: _restrictedFacts, ...publicJudgment } = judgment as ModelOperationJudgment & { restrictedFacts?: unknown };
  return publicJudgment;
}
