import type { AgentOptions, RunResult, SDKAgent, SendOptions } from "@cursor/sdk";
import type { BriefGenerationContext, BriefingDraft, BriefingOutline, RankedSourceCandidate, SourceProcessingResult, SourceType, ValidationIssue } from "../domain/types.js";

export interface AgentClient {
  create(options: AgentOptions): Promise<SDKAgent>;
}

export interface AgentRunPayload {
  outline: BriefingOutline;
  draft: BriefingDraft;
}

export interface DailyBriefingRunResult extends AgentRunPayload {
  candidates: RankedSourceCandidate[];
  sourceResults: Record<SourceType, SourceProcessingResult>;
  validationIssues: ValidationIssue[];
}

export interface DailyBriefingRunInput {
  context: BriefGenerationContext;
  briefingDate: string;
  inputDir: string;
}

export interface CursorSdkRuntimeOptions {
  apiKey: string;
  model: string;
  cwd: string;
  maxRevisions: number;
}

export interface AgentSendRecord {
  message: string;
  options?: SendOptions;
}

export interface CompletedRun {
  id: string;
  result: RunResult;
}
