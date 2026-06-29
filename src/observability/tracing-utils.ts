/**
 * Provider-agnostic helpers for daily-briefing tracing.
 *
 * This module is not tied to Langfuse, TraceRoot, or any export backend. It prepares
 * domain data before it is written into spans (truncate large payloads, aggregate Cursor
 * SDK stream events, normalize tool names) and redacts secrets before export.
 *
 * Used by:
 * - otel-daily-briefing-tracer.ts — most helpers when building span input/output
 * - providers/langfuse.ts — redactSecrets in LangfuseSpanProcessor mask callback
 *
 * Span lifecycle (start / update / end) lives in otel-daily-briefing-tracer.ts;
 * provider wiring lives under providers/.
 */
import type { SDKMessage } from "@cursor/sdk";
import type { AgentRunPayload } from "../agent/types.js";

export function displayToolName(event: Extract<SDKMessage, { type: "tool_call" }>): string {
  if (event.name !== "mcp" || !isRecord(event.args)) return event.name;
  const provider = typeof event.args.providerIdentifier === "string" ? event.args.providerIdentifier : "mcp";
  const toolName = typeof event.args.toolName === "string" ? event.args.toolName : "unknown";
  return `${provider}.${toolName}`;
}

export function summarizeDraft(draft: AgentRunPayload["draft"]): Record<string, unknown> {
  return {
    sections: draft.sections.map((section) => ({
      sectionId: section.sectionId,
      title: section.title,
      candidateIds: section.candidateIds,
      text: section.text,
      textLength: section.text.length,
    })),
    fullTextWithSectionMarkers: draft.fullTextWithSectionMarkers,
    finalTtsText: draft.finalTtsText,
  };
}

export function summarizeToolResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.slice(0, 50),
    };
  }
  if (typeof value === "string") {
    return truncate(value, 8000);
  }
  return value;
}

export type StreamSummary = {
  counts: Record<string, number>;
  assistantText: string[];
  thinkingText: string[];
  statuses: Array<{ status: string; message?: string }>;
  tasks: Array<{ status?: string; text?: string }>;
  requests: Array<{ requestId: string }>;
};

export function createStreamSummary(): StreamSummary {
  return {
    counts: {},
    assistantText: [],
    thinkingText: [],
    statuses: [],
    tasks: [],
    requests: [],
  };
}

export function appendStreamEvent(summary: StreamSummary, event: SDKMessage): void {
  summary.counts[event.type] = (summary.counts[event.type] ?? 0) + 1;
  if (event.type === "assistant") {
    const text = event.message.content
      .map((block) => {
        if (block.type === "text") return block.text;
        return `[tool_use:${block.name}]`;
      })
      .join("");
    if (text.trim()) summary.assistantText.push(text);
    return;
  }
  if (event.type === "thinking") {
    if (event.text.trim()) summary.thinkingText.push(event.text);
    return;
  }
  if (event.type === "status") {
    summary.statuses.push({ status: event.status, message: event.message });
    return;
  }
  if (event.type === "task") {
    summary.tasks.push({ status: event.status, text: event.text });
    return;
  }
  if (event.type === "request") {
    summary.requests.push({ requestId: event.request_id });
  }
}

export function redactSecrets(data: unknown): unknown {
  if (typeof data === "string") {
    return data
      .replace(/cursor_[A-Za-z0-9_-]+/g, "cursor_***")
      .replace(/sk-lf-[A-Za-z0-9_-]+/g, "sk-lf-***")
      .replace(/pk-lf-[A-Za-z0-9_-]+/g, "pk-lf-***")
      .replace(/tr_[A-Za-z0-9_-]+/g, "tr_***");
  }
  return data;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function numberField(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
