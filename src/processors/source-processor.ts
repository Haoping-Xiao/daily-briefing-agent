import type {
  BriefingItem,
  CandidateScore,
  DiscardedItem,
  PrivacyOperation,
  RankedSourceCandidate,
  SourcePolicy,
  SourceProcessingResult,
  SourceType,
  TopicTag,
} from "../domain/types.js";
import { evaluateRuleExpression, type RuleContext } from "../rules/rule-expression.js";
import { buildRestrictedFacts, buildSpeakableFacts } from "./facts.js";

export interface SourceProcessor<TItem extends BriefingItem> {
  readonly sourceType: SourceType;
  process(items: TItem[], policy: SourcePolicy): Promise<SourceProcessingResult>;
}

export function processItems<TItem extends BriefingItem>(
  items: TItem[],
  policy: SourcePolicy,
  extraCandidates: RankedSourceCandidate[] = [],
): SourceProcessingResult {
  const discarded: DiscardedItem[] = [];
  const candidates: RankedSourceCandidate[] = [];
  const filterOperations = policy.operations.filter((operation) => operation.type === "filter");
  const scoringOperations = policy.operations.filter((operation) => operation.type === "score");
  const tagOperations = policy.operations.filter((operation) => operation.type === "tag");
  const privacyOperations = policy.operations.filter((operation) => operation.type === "privacy");

  for (const item of items) {
    const context = contextFor(item);
    const dropOperation = filterOperations.find(
      (operation) => operation.action === "drop" && evaluateRuleExpression(operation.when, context),
    );
    if (dropOperation) {
      discarded.push({ id: item.id, sourceType: item.sourceType, reason: dropOperation.reasonTemplate });
      continue;
    }

    const filterReasons = filterOperations
      .filter((operation) => operation.action === "deprioritize" && evaluateRuleExpression(operation.when, context))
      .map((operation) => operation.reasonTemplate);

    const score: CandidateScore = { value: 10, reasons: [] };
    let mustInclude = false;
    for (const operation of scoringOperations) {
      if (!evaluateRuleExpression(operation.when, context)) continue;
      score.value += operation.delta;
      mustInclude ||= operation.mustInclude === true;
      score.reasons.push({ source: "rule", label: operation.id, reason: operation.reasonTemplate, delta: operation.delta });
    }
    if (filterReasons.length > 0) {
      score.value -= 20;
    }

    const topicTags = unique(
      tagOperations
        .filter((operation) => evaluateRuleExpression(operation.when, context))
        .map((operation) => operation.topicTag),
    );
    const matchingPrivacyOperations = privacyOperations.filter((operation) => evaluateRuleExpression(operation.when, context));
    const speakableFacts = applyPrivacyToSpeakableFacts(item, matchingPrivacyOperations);
    const restrictedFacts = [
      ...buildRestrictedFacts(item),
      ...matchingPrivacyOperations.map((operation) => ({
        redactedLabel: operation.redactedLabel,
        reason: operation.reason,
      })),
    ];

    candidates.push({
      id: item.id,
      sourceType: item.sourceType,
      title: item.title,
      topicTags,
      score,
      mustInclude,
      filterReasons,
      modelJudgments: [],
      speakableFacts,
      restrictedFacts: uniqueBy(restrictedFacts, (fact) => `${fact.redactedLabel}:${fact.reason}`),
      originalItemIds: [item.id],
    });
  }

  const sorted = [...extraCandidates, ...candidates].sort((a, b) => Number(b.mustInclude) - Number(a.mustInclude) || b.score.value - a.score.value);
  return { candidates: sorted, discarded };
}

export function contextFor(item: BriefingItem): RuleContext {
  const labels = item.sourceType === "email" ? item.labels : [];
  const visibility = item.sourceType === "calendar" ? item.visibility : undefined;
  const source = item.sourceType === "news" ? item.source : undefined;
  const titleAndSummary = `${item.title} ${item.summary} ${source ?? ""}`;
  return {
    sourceType: item.sourceType,
    title: item.title,
    summary: item.summary,
    titleAndSummary,
    labels,
    visibility,
  };
}

export function unique<T>(values: T[]): T[] {
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

function applyPrivacyToSpeakableFacts(item: BriefingItem, privacyOperations: PrivacyOperation[]) {
  if (privacyOperations.length === 0) return buildSpeakableFacts(item);
  const fact = `${item.title}. ${item.summary}`;
  return [{ raw: fact, spoken: privacyOperations[0].spokenReplacement }];
}

export function scoreReason(label: string, reason: string, delta: number) {
  return { source: "rule" as const, label, reason, delta };
}

export function tags(...values: TopicTag[]): TopicTag[] {
  return unique(values);
}
