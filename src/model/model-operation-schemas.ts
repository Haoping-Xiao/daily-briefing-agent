import { z } from "zod";
import type { ModelOperationJudgment, ModelOperationOutputSchemaName, TopicTag } from "../domain/types.js";

const TOPIC_TAGS = [
  "schedule",
  "schedule_conflict",
  "board_prep",
  "customer_research",
  "partner_stripe",
  "vendor_plaid",
  "competitor_lyra",
  "company_launch",
  "fintech_regulation",
  "psd3",
  "ai_product",
  "developer_tools",
  "personal_family",
] as const;

export const TopicTagSchema = z.enum([
  ...TOPIC_TAGS,
]) satisfies z.ZodType<TopicTag>;

const topicTagSet = new Set<string>(TOPIC_TAGS);

const JudgmentBaseSchema = z.object({
  operationId: z.string(),
  candidateId: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ModelRelevanceJudgmentSchema = JudgmentBaseSchema.extend({
  schema: z.literal("ModelRelevanceJudgment"),
  action: z.enum(["keep", "drop", "deprioritize"]),
  scoreDelta: z.number().optional(),
  topicTags: z.array(TopicTagSchema).optional(),
});

export const ModelBriefingValueJudgmentSchema = JudgmentBaseSchema.extend({
  schema: z.literal("ModelBriefingValueJudgment"),
  scoreDelta: z.number(),
  mustInclude: z.boolean().optional(),
});

export const ModelPrivacyJudgmentSchema = JudgmentBaseSchema.extend({
  schema: z.literal("ModelPrivacyJudgment"),
  hasPrivacyRisk: z.boolean(),
  restrictedFacts: z.array(z.object({ redactedLabel: z.string(), reason: z.string() })).optional(),
  speakableFacts: z.array(z.object({ raw: z.string(), spoken: z.string() })).optional(),
});

export const ModelOperationJudgmentSchema: z.ZodType<ModelOperationJudgment> = z.discriminatedUnion("schema", [
  ModelRelevanceJudgmentSchema,
  ModelBriefingValueJudgmentSchema,
  ModelPrivacyJudgmentSchema,
]);

export const ModelOperationBatchSchema = z.object({
  judgments: z.array(ModelOperationJudgmentSchema),
});

export function schemaForModelOperation(name: ModelOperationOutputSchemaName): z.ZodType<ModelOperationJudgment> {
  if (name === "ModelRelevanceJudgment") return ModelRelevanceJudgmentSchema;
  if (name === "ModelBriefingValueJudgment") return ModelBriefingValueJudgmentSchema;
  return ModelPrivacyJudgmentSchema;
}

export function parseModelOperationBatch(resultText: string | undefined): ModelOperationJudgment[] {
  if (!resultText) {
    throw new Error("Model operation agent finished without result text.");
  }
  const parsed = JSON.parse(extractJson(resultText));
  return ModelOperationBatchSchema.parse(normalizeModelOperationBatch(parsed)).judgments;
}

function extractJson(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first >= 0 && last > first) return value.slice(first, last + 1);
  return value;
}

function normalizeModelOperationBatch(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("judgments" in value)) return value;
  const batch = value as { judgments: unknown };
  if (!Array.isArray(batch.judgments)) return value;
  return {
    ...value,
    judgments: batch.judgments.map(normalizeJudgment),
  };
}

function normalizeJudgment(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const judgment = value as {
    schema?: unknown;
    topicTags?: unknown;
    restrictedFacts?: unknown;
    speakableFacts?: unknown;
  };

  let next: Record<string, unknown> = { ...(value as Record<string, unknown>) };

  if (judgment.schema === "ModelRelevanceJudgment" && Array.isArray(judgment.topicTags)) {
    next = {
      ...next,
      topicTags: judgment.topicTags.filter((tag): tag is TopicTag => typeof tag === "string" && topicTagSet.has(tag)),
    };
  }

  if (judgment.schema === "ModelPrivacyJudgment") {
    if (judgment.restrictedFacts !== undefined) {
      next.restrictedFacts = normalizeRestrictedFacts(judgment.restrictedFacts);
    }
    if (judgment.speakableFacts !== undefined) {
      next.speakableFacts = normalizeSpeakableFacts(judgment.speakableFacts);
    }
  }

  return next;
}

function normalizeRestrictedFacts(value: unknown): Array<{ redactedLabel: string; reason: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ redactedLabel: item, reason: item }];
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const redactedLabel = pickString(record, ["redactedLabel", "label", "name"]);
      const reason = pickString(record, ["reason", "description"]) ?? redactedLabel;
      if (redactedLabel) {
        return [{ redactedLabel, reason: reason ?? redactedLabel }];
      }
    }
    return [];
  });
}

function normalizeSpeakableFacts(value: unknown): Array<{ raw: string; spoken: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ raw: item, spoken: item }];
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const raw = pickString(record, ["raw", "text", "value"]);
      const spoken = pickString(record, ["spoken", "tts", "speech"]) ?? raw;
      if (raw && spoken) {
        return [{ raw, spoken }];
      }
    }
    return [];
  });
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
