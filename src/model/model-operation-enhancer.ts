import type { SDKAgent } from "@cursor/sdk";
import type { AgentClient } from "../agent/types.js";
import type {
  DiscardedItem,
  ModelOperation,
  ModelOperationJudgment,
  RankedSourceCandidate,
  SourcePolicy,
  SourceProcessingResult,
  SourceType,
} from "../domain/types.js";
import { evaluateRuleExpression, type RuleContext } from "../rules/rule-expression.js";
import { parseModelOperationBatch } from "./model-operation-schemas.js";

export interface ModelOperationEnhancer {
  enhance(result: SourceProcessingResult, policy: SourcePolicy): Promise<SourceProcessingResult>;
}

export interface CursorSdkModelOperationOptions {
  apiKey: string;
  model: string;
  cwd: string;
}

export class CursorSdkModelOperationEnhancer implements ModelOperationEnhancer {
  constructor(
    private readonly client: AgentClient,
    private readonly options: CursorSdkModelOperationOptions,
  ) {}

  async enhance(result: SourceProcessingResult, policy: SourcePolicy): Promise<SourceProcessingResult> {
    const requests = buildModelOperationRequests(result.candidates, policy);
    if (requests.length === 0) return stripPendingModelRequests(result);

    let agent: SDKAgent | undefined;
    try {
      agent = await this.client.create({
        apiKey: this.options.apiKey,
        model: { id: this.options.model },
        local: {
          cwd: this.options.cwd,
          settingSources: [],
        },
      });
      const run = await agent.send(buildModelOperationPrompt(policy.sourceType, requests));
      await drainStream(run.stream());
      const completed = await run.wait();
      if (completed.status !== "finished") {
        throw new Error(`Model operation agent run ${completed.id} ended with status ${completed.status}.`);
      }
      return applyModelJudgments(result, parseModelOperationBatch(completed.result));
    } finally {
      if (agent) {
        await agent[Symbol.asyncDispose]();
      }
    }
  }
}

export class NoopModelOperationEnhancer implements ModelOperationEnhancer {
  async enhance(result: SourceProcessingResult): Promise<SourceProcessingResult> {
    return stripPendingModelRequests(result);
  }
}

export function buildModelOperationRequests(candidates: RankedSourceCandidate[], policy: SourcePolicy): ModelOperationRequest[] {
  const operations = policy.operations.filter((operation) => operation.type === "model");
  return candidates.flatMap((candidate) => {
    const context = contextForCandidate(candidate);
    return operations
      .filter((operation) => evaluateRuleExpression(operation.when, context))
      .map((operation) => ({
        operation,
        candidate,
      }));
  });
}

export interface ModelOperationRequest {
  operation: ModelOperation;
  candidate: RankedSourceCandidate;
}

export function applyModelJudgments(
  result: SourceProcessingResult,
  judgments: ModelOperationJudgment[],
): SourceProcessingResult {
  const judgmentsByCandidate = groupBy(judgments, (judgment) => judgment.candidateId);
  const discarded: DiscardedItem[] = [...result.discarded];
  const candidates: RankedSourceCandidate[] = [];

  for (const candidate of result.candidates) {
    const candidateJudgments = (judgmentsByCandidate.get(candidate.id) ?? []).filter(
      (judgment) => !isConflictingModelJudgment(candidate, judgment),
    );
    const dropJudgment = candidateJudgments.find(
      (judgment) => judgment.schema === "ModelRelevanceJudgment" && judgment.action === "drop",
    );
    if (dropJudgment) {
      discarded.push({ id: candidate.id, sourceType: candidate.sourceType, reason: dropJudgment.reason });
      continue;
    }

    candidates.push(applyCandidateJudgments(candidate, candidateJudgments));
  }

  return {
    candidates: candidates.sort((a, b) => Number(b.mustInclude) - Number(a.mustInclude) || b.score.value - a.score.value),
    discarded,
  };
}

function isConflictingModelJudgment(candidate: RankedSourceCandidate, judgment: ModelOperationJudgment): boolean {
  return candidate.mustInclude && judgment.schema === "ModelRelevanceJudgment" && judgment.action === "drop";
}

function applyCandidateJudgments(candidate: RankedSourceCandidate, judgments: ModelOperationJudgment[]): RankedSourceCandidate {
  let next: RankedSourceCandidate = {
    ...candidate,
    modelJudgments: judgments,
    topicTags: [...candidate.topicTags],
    score: {
      value: candidate.score.value,
      reasons: [...candidate.score.reasons],
    },
    filterReasons: [...candidate.filterReasons],
    speakableFacts: [...candidate.speakableFacts],
    restrictedFacts: [...candidate.restrictedFacts],
  };

  for (const judgment of judgments) {
    if (judgment.schema === "ModelRelevanceJudgment") {
      if (judgment.action === "deprioritize") {
        next.filterReasons.push(judgment.reason);
      }
      const delta = judgment.scoreDelta ?? (judgment.action === "deprioritize" ? -20 : 0);
      next = applyModelScore(next, judgment.operationId, judgment.reason, delta, judgment.confidence);
      next.topicTags = unique([...(next.topicTags), ...(judgment.topicTags ?? [])]);
      continue;
    }
    if (judgment.schema === "ModelBriefingValueJudgment") {
      next = applyModelScore(next, judgment.operationId, judgment.reason, judgment.scoreDelta, judgment.confidence);
      next.mustInclude ||= judgment.mustInclude === true;
      continue;
    }
    if (judgment.schema === "ModelPrivacyJudgment" && judgment.hasPrivacyRisk) {
      next.restrictedFacts = uniqueBy([...next.restrictedFacts, ...(judgment.restrictedFacts ?? [])], (fact) => `${fact.redactedLabel}:${fact.reason}`);
      if (judgment.speakableFacts && judgment.speakableFacts.length > 0) {
        next.speakableFacts = judgment.speakableFacts;
      }
    }
  }

  return next;
}

function applyModelScore(
  candidate: RankedSourceCandidate,
  label: string,
  reason: string,
  delta: number,
  confidence: number,
): RankedSourceCandidate {
  if (delta === 0) return candidate;
  return {
    ...candidate,
    score: {
      value: candidate.score.value + delta,
      reasons: [...candidate.score.reasons, { source: "model", label, reason, delta, confidence }],
    },
  };
}

function stripPendingModelRequests(result: SourceProcessingResult): SourceProcessingResult {
  return {
    discarded: result.discarded,
    candidates: result.candidates.map((candidate) => ({ ...candidate, modelJudgments: candidate.modelJudgments ?? [] })),
  };
}

function buildModelOperationPrompt(sourceType: SourceType, requests: ModelOperationRequest[]): string {
  return [
    "You are a source-processing model judge for a daily audio briefing.",
    "You do not have tools. Use only the JSON below as evidence.",
    "Return only valid JSON with shape: { \"judgments\": ModelOperationJudgment[] }.",
    "Each judgment must match the requested outputSchema exactly and include operationId, candidateId, reason, and confidence from 0 to 1.",
    "Schema details:",
    "- ModelRelevanceJudgment: { schema, operationId, candidateId, action: keep|drop|deprioritize, reason, confidence, scoreDelta?, topicTags? }.",
    "- ModelBriefingValueJudgment: { schema, operationId, candidateId, scoreDelta, mustInclude?, reason, confidence }.",
    "- ModelPrivacyJudgment: { schema, operationId, candidateId, hasPrivacyRisk, restrictedFacts?, speakableFacts?, reason, confidence }.",
    `Source type: ${sourceType}`,
    "",
    "Requests JSON:",
    JSON.stringify(
      requests.map(({ operation, candidate }) => ({
        operation: {
          id: operation.id,
          task: operation.task,
          prompt: operation.prompt,
          outputSchema: operation.outputSchema,
        },
        candidate: {
          id: candidate.id,
          sourceType: candidate.sourceType,
          title: candidate.title,
          topicTags: candidate.topicTags,
          score: candidate.score,
          mustInclude: candidate.mustInclude,
          filterReasons: candidate.filterReasons,
          speakableFacts: candidate.speakableFacts,
          restrictedFacts: candidate.restrictedFacts,
          originalItemIds: candidate.originalItemIds,
        },
      })),
      null,
      2,
    ),
  ].join("\n");
}

async function drainStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of stream) {
  }
}

function contextForCandidate(candidate: RankedSourceCandidate): RuleContext {
  const summary = candidate.speakableFacts.map((fact) => fact.raw).join(" ");
  return {
    sourceType: candidate.sourceType,
    title: candidate.title,
    summary,
    titleAndSummary: `${candidate.title} ${summary}`,
  };
}

function groupBy<T>(values: T[], keyFor: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
