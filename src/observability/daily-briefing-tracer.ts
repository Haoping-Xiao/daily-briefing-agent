import type { RunResult, SDKMessage, SendOptions } from "@cursor/sdk";
import type { AgentRunPayload } from "../agent/types.js";
import type { RankedSourceCandidate, SourceProcessingResult, SourceType, ValidationIssue } from "../domain/types.js";

export interface DailyBriefingTracer {
  startTrace(input: DailyBriefingTraceInput): DailyBriefingTrace;
  flush(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface DailyBriefingTrace {
  recordSourceProcessing(summary: SourceProcessingObservation): void;
  startAgentRun(input: AgentRunTraceInput): AgentRunTrace;
  recordValidationAttempt(summary: ValidationAttemptObservation): void;
  recordFinalResult(result: FinalResultObservation): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface AgentRunTrace {
  readonly sendOptions: SendOptions;
  recordStreamEvent(event: SDKMessage): void;
  recordRunResult(result: RunResult): void;
  recordParsedPayload(payload: AgentRunPayload): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface DailyBriefingTraceInput {
  briefingDate: string;
  inputDir: string;
  model: string;
  maxRevisions: number;
}

export interface AgentRunTraceInput {
  kind: "initial" | "revision";
  attempt: number;
  prompt: string;
  agentId: string;
  model: string;
}

export interface ValidationAttemptObservation {
  attempt: number;
  issueCount: number;
  issues: ValidationIssue[];
}

export interface FinalResultObservation {
  outline: AgentRunPayload["outline"];
  draft: AgentRunPayload["draft"];
  revisionCount: number;
}

export interface SourceProcessingObservation {
  sources: Record<SourceType, SourceObservation>;
  totals: {
    candidateCount: number;
    discardedCount: number;
    mustIncludeCount: number;
  };
}

export interface SourceObservation {
  candidateCount: number;
  discardedCount: number;
  candidateRanking: CandidateObservation[];
  discarded: SourceProcessingResult["discarded"];
}

export interface CandidateObservation {
  id: string;
  sourceType: SourceType;
  rank: number;
  title: string;
  score: RankedSourceCandidate["score"];
  mustInclude: boolean;
  filterReasons: string[];
  topicTags: RankedSourceCandidate["topicTags"];
  modelJudgments: RankedSourceCandidate["modelJudgments"];
  speakableFacts: RankedSourceCandidate["speakableFacts"];
  restrictedFacts: RankedSourceCandidate["restrictedFacts"];
  originalItemIds: string[];
}

export function summarizeSourceProcessing(sourceResults: Record<SourceType, SourceProcessingResult>): SourceProcessingObservation {
  const sources = Object.fromEntries(
    Object.entries(sourceResults).map(([sourceType, result]) => [
      sourceType,
      {
        candidateCount: result.candidates.length,
        discardedCount: result.discarded.length,
        candidateRanking: result.candidates.map((candidate, index) => summarizeCandidate(candidate, index)),
        discarded: result.discarded,
      },
    ]),
  ) as Record<SourceType, SourceObservation>;

  const allCandidates = Object.values(sourceResults).flatMap((result) => result.candidates);
  const allDiscarded = Object.values(sourceResults).flatMap((result) => result.discarded);
  return {
    sources,
    totals: {
      candidateCount: allCandidates.length,
      discardedCount: allDiscarded.length,
      mustIncludeCount: allCandidates.filter((candidate) => candidate.mustInclude).length,
    },
  };
}

export class NoopDailyBriefingTracer implements DailyBriefingTracer {
  startTrace(_input: DailyBriefingTraceInput): DailyBriefingTrace {
    return new NoopDailyBriefingTrace();
  }

  async flush(): Promise<void> {}
}

class NoopDailyBriefingTrace implements DailyBriefingTrace {
  recordSourceProcessing(_summary: SourceProcessingObservation): void {}
  startAgentRun(_input: AgentRunTraceInput): AgentRunTrace {
    return new NoopAgentRunTrace();
  }
  recordValidationAttempt(_summary: ValidationAttemptObservation): void {}
  recordFinalResult(_result: FinalResultObservation): void {}
  recordError(_error: unknown): void {}
  end(): void {}
}

class NoopAgentRunTrace implements AgentRunTrace {
  readonly sendOptions: SendOptions = {};
  recordStreamEvent(_event: SDKMessage): void {}
  recordRunResult(_result: RunResult): void {}
  recordParsedPayload(_payload: AgentRunPayload): void {}
  recordError(_error: unknown): void {}
  end(): void {}
}

function summarizeCandidate(candidate: RankedSourceCandidate, index: number): CandidateObservation {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    rank: index + 1,
    title: candidate.title,
    score: candidate.score,
    mustInclude: candidate.mustInclude,
    filterReasons: candidate.filterReasons,
    topicTags: candidate.topicTags,
    modelJudgments: candidate.modelJudgments,
    speakableFacts: candidate.speakableFacts,
    restrictedFacts: candidate.restrictedFacts,
    originalItemIds: candidate.originalItemIds,
  };
}
