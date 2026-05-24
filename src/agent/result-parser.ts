import { z } from "zod";
import type { AgentRunPayload } from "./types.js";

const TopicTagSchema = z.enum([
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
]);

const AgentRunPayloadSchema: z.ZodType<AgentRunPayload> = z.object({
  outline: z.object({
    themes: z.array(
      z.object({
        id: z.string(),
        topicTags: z.array(TopicTagSchema),
        candidateIds: z.array(z.string()),
        reason: z.string(),
      }),
    ),
    sections: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        candidateIds: z.array(z.string()),
        coveredInputItemIds: z.object({
          calendar: z.array(z.string()),
          emails: z.array(z.string()),
          news: z.array(z.string()),
        }),
        targetWords: z.number(),
      }),
    ),
    mustIncludeCandidateIds: z.array(z.string()),
    excludedCandidateIds: z.array(z.object({ id: z.string(), reason: z.string() })),
    discardedInputItems: z.array(z.object({ id: z.string(), sourceType: z.enum(["calendar", "email", "news"]), reason: z.string() })),
    explorationReasoning: z.array(z.string()),
  }),
  draft: z.object({
    sections: z.array(
      z.object({
        sectionId: z.string(),
        title: z.string(),
        text: z.string(),
        candidateIds: z.array(z.string()),
      }),
    ),
    fullTextWithSectionMarkers: z.string(),
    finalTtsText: z.string(),
  }),
});

export function parseAgentRunPayload(resultText: string | undefined): AgentRunPayload {
  if (!resultText) {
    throw new Error("Cursor SDK run finished without result text.");
  }
  const jsonText = extractJson(resultText);
  return AgentRunPayloadSchema.parse(normalizePayload(JSON.parse(jsonText)));
}

function extractJson(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first >= 0 && last > first) return value.slice(first, last + 1);
  return value;
}

function normalizePayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const outline = isRecord(value.outline) ? value.outline : {};
  const rawSections = asArray(outline.sections);
  const normalizedSections = rawSections.map((section, index) => normalizeOutlineSection(section, index));
  const draft = isRecord(value.draft) ? value.draft : {};
  return {
    outline: {
      themes: asArray(outline.themes).map(normalizeTheme),
      sections: normalizedSections,
      mustIncludeCandidateIds: asStringArray(outline.mustIncludeCandidateIds),
      excludedCandidateIds: asArray(outline.excludedCandidateIds).map(normalizeExcludedCandidate),
      discardedInputItems: asArray(outline.discardedInputItems).map(normalizeDiscardedInputItem),
      explorationReasoning: asStringArray(outline.explorationReasoning),
    },
    draft: {
      sections: asArray(draft.sections).map((section, index) =>
        normalizeDraftSection(section, idOf(normalizedSections[index]) ?? `section-${index + 1}`),
      ),
      fullTextWithSectionMarkers: stringField(draft.fullTextWithSectionMarkers, draft.fullText, draft.markedText),
      finalTtsText: stringField(draft.finalTtsText, draft.finalText, draft.ttsText, draft.text),
    },
  };
}

function normalizeTheme(value: unknown): unknown {
  if (typeof value === "string") {
    return { id: slugify(value), topicTags: [], candidateIds: [], reason: value };
  }
  if (!isRecord(value)) return value;
  return {
    id: stringField(value.id, value.name, value.title, "theme"),
    topicTags: asArray(value.topicTags).filter((tag): tag is z.infer<typeof TopicTagSchema> => TopicTagSchema.safeParse(tag).success),
    candidateIds: asStringArray(value.candidateIds),
    reason: stringField(value.reason, value.description, value.name, value.title),
  };
}

function normalizeOutlineSection(value: unknown, index: number): unknown {
  if (!isRecord(value)) return value;
  const name = stringField(value.name, value.title, `Section ${index + 1}`);
  const id = stringField(value.id, value.sectionId, slugify(name) || `section-${index + 1}`);
  return {
    id,
    name,
    candidateIds: asStringArray(value.candidateIds),
    coveredInputItemIds: normalizeCoveredInputItemIds(value.coveredInputItemIds),
    targetWords: numberField(value.targetWords, value.wordBudget, 0),
  };
}

function normalizeDraftSection(value: unknown, fallbackSectionId: string): unknown {
  if (!isRecord(value)) return value;
  return {
    sectionId: stringField(value.sectionId, value.id, fallbackSectionId),
    title: stringField(value.title, value.name, fallbackSectionId),
    text: stringField(value.text, value.content),
    candidateIds: asStringArray(value.candidateIds),
  };
}

function normalizeExcludedCandidate(value: unknown): unknown {
  if (typeof value === "string") return { id: value, reason: "Excluded by agent." };
  if (!isRecord(value)) return value;
  return { id: stringField(value.id, value.candidateId), reason: stringField(value.reason, "Excluded by agent.") };
}

function normalizeDiscardedInputItem(value: unknown): unknown {
  if (typeof value === "string") {
    return { id: value, sourceType: sourceTypeFromId(value), reason: "Discarded by agent." };
  }
  if (!isRecord(value)) return value;
  const id = stringField(value.id, value.candidateId);
  return {
    id,
    sourceType: sourceTypeFromId(id, value.sourceType),
    reason: stringField(value.reason, "Discarded by agent."),
  };
}

function normalizeCoveredInputItemIds(value: unknown): unknown {
  if (!isRecord(value)) return { calendar: [], emails: [], news: [] };
  return {
    calendar: asStringArray(value.calendar),
    emails: asStringArray(value.emails),
    news: asStringArray(value.news),
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function stringField(...values: unknown[]): string {
  const value = values.find((candidate) => typeof candidate === "string");
  return typeof value === "string" ? value : "";
}

function numberField(...values: unknown[]): number {
  const value = values.find((candidate) => typeof candidate === "number");
  return typeof value === "number" ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function idOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
}

function sourceTypeFromId(id: string, explicit?: unknown): "calendar" | "email" | "news" {
  if (explicit === "calendar" || explicit === "email" || explicit === "news") return explicit;
  if (id.startsWith("cal_") || id.startsWith("calendar_")) return "calendar";
  if (id.startsWith("em_") || id.startsWith("email_")) return "email";
  return "news";
}
