import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { RunResult, SDKMessage, SendOptions } from "@cursor/sdk";
import type { AgentRunPayload } from "../agent/types.js";
import type {
  AgentRunTrace,
  AgentRunTraceInput,
  DailyBriefingTrace,
  DailyBriefingTraceInput,
  DailyBriefingTracer,
  FinalResultObservation,
  SourceProcessingObservation,
  ValidationAttemptObservation,
} from "./daily-briefing-tracer.js";
import { NoopDailyBriefingTracer } from "./daily-briefing-tracer.js";

type LangfuseHandle = {
  update(attributes: Record<string, unknown>): LangfuseHandle;
  end(): void;
  startObservation(name: string, attributes?: Record<string, unknown>, options?: { asType: string }): LangfuseHandle;
};

export function createLangfuseDailyBriefingTracerFromEnv(env: NodeJS.ProcessEnv = process.env): DailyBriefingTracer {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = env.LANGFUSE_BASE_URL?.trim();

  if (!publicKey || !secretKey) {
    return new NoopDailyBriefingTracer();
  }

  try {
    return new LangfuseDailyBriefingTracer({
      publicKey,
      secretKey,
      baseUrl,
    });
  } catch {
    return new NoopDailyBriefingTracer();
  }
}

class LangfuseDailyBriefingTracer implements DailyBriefingTracer {
  private readonly sdk: NodeSDK;
  private readonly spanProcessor: LangfuseSpanProcessor;

  constructor(input: { publicKey: string; secretKey: string; baseUrl?: string }) {
    this.spanProcessor = new LangfuseSpanProcessor({
      publicKey: input.publicKey,
      secretKey: input.secretKey,
      baseUrl: input.baseUrl,
      exportMode: "immediate",
      mask: ({ data }) => redactSecrets(data),
    });
    this.sdk = new NodeSDK({
      spanProcessors: [this.spanProcessor],
    });
    this.sdk.start();
  }

  startTrace(input: DailyBriefingTraceInput): DailyBriefingTrace {
    const root = startObservation(
      "daily-briefing.run",
      {
        input: {
          briefingDate: input.briefingDate,
          inputDir: input.inputDir,
        },
        metadata: {
          model: input.model,
          maxRevisions: input.maxRevisions,
        },
      },
      { asType: "agent" },
    ) as LangfuseHandle;
    return new LangfuseDailyBriefingTrace(root, input);
  }

  async flush(): Promise<void> {
    try {
      await this.spanProcessor.forceFlush();
    } catch {}
  }

  async shutdown(): Promise<void> {
    try {
      await this.sdk.shutdown();
    } catch {}
  }
}

class LangfuseDailyBriefingTrace implements DailyBriefingTrace {
  private readonly startedAt = Date.now();
  private validationIssueCount = 0;

  constructor(
    private readonly root: LangfuseHandle,
    private readonly input: DailyBriefingTraceInput,
  ) {}

  recordSourceProcessing(summary: SourceProcessingObservation): void {
    const span = this.root.startObservation(
      "source-processing",
      {
        input: {
          briefingDate: this.input.briefingDate,
        },
        output: summary,
        metadata: {
          candidateCount: summary.totals.candidateCount,
          discardedCount: summary.totals.discardedCount,
          mustIncludeCount: summary.totals.mustIncludeCount,
        },
      },
      { asType: "retriever" },
    );
    span.end();
  }

  startAgentRun(input: AgentRunTraceInput): AgentRunTrace {
    return new LangfuseAgentRunTrace(this.root, input);
  }

  recordValidationAttempt(summary: ValidationAttemptObservation): void {
    this.validationIssueCount += summary.issueCount;
    const span = this.root.startObservation(
      `validation.attempt-${summary.attempt}`,
      {
        input: { attempt: summary.attempt },
        output: summary,
        metadata: {
          issueCount: summary.issueCount,
          validators: [...new Set(summary.issues.map((issue) => issue.validator))],
        },
        level: summary.issueCount > 0 ? "WARNING" : "DEFAULT",
      },
      { asType: "evaluator" },
    );
    span.end();
  }

  recordFinalResult(result: FinalResultObservation): void {
    this.root.update({
      output: {
        status: "finished",
        revisionCount: result.revisionCount,
        outline: result.outline,
        draft: summarizeDraft(result.draft),
      },
      metadata: {
        durationMs: Date.now() - this.startedAt,
        validationIssueCount: this.validationIssueCount,
        finalTextLength: result.draft.finalTtsText.length,
        sectionCount: result.draft.sections.length,
      },
    });
  }

  recordError(error: unknown): void {
    this.root.update({
      level: "ERROR",
      statusMessage: errorMessage(error),
      output: {
        status: "error",
        error: errorMessage(error),
      },
    });
  }

  end(): void {
    this.root.end();
  }
}

class LangfuseAgentRunTrace implements AgentRunTrace {
  readonly sendOptions: SendOptions = {
    onDelta: ({ update }) => {
      this.recordDelta(update);
    },
    onStep: ({ step }) => {
      this.recordStep(step);
    },
  };

  private readonly span: LangfuseHandle;
  private readonly toolCalls = new Map<string, { observation: LangfuseHandle; name: string }>();
  private readonly toolNames = new Set<string>();
  private usageDetails: Record<string, number> | undefined;
  private deltaCount = 0;
  private stepCount = 0;
  private readonly streamSummary = createStreamSummary();

  constructor(parent: LangfuseHandle, private readonly input: AgentRunTraceInput) {
    this.span = parent.startObservation(
      `cursor-sdk.${input.kind}`,
      {
        input: {
          kind: input.kind,
          attempt: input.attempt,
          promptLength: input.prompt.length,
          promptPreview: truncate(input.prompt, 2000),
        },
        metadata: {
          agentId: input.agentId,
          model: input.model,
        },
      },
      { asType: "agent" },
    );
  }

  recordStreamEvent(event: SDKMessage): void {
    if (event.type === "tool_call") {
      this.recordToolCall(event);
      return;
    }

    appendStreamEvent(this.streamSummary, event);
  }

  recordRunResult(result: RunResult): void {
    this.span.update({
      output: {
        runId: result.id,
        status: result.status,
        resultPreview: truncate(result.result ?? "", 4000),
        durationMs: result.durationMs,
        git: result.git,
      },
      metadata: {
        toolNames: [...this.toolNames],
        deltaCount: this.deltaCount,
        stepCount: this.stepCount,
        usageDetails: this.usageDetails,
        streamEventCounts: this.streamSummary.counts,
      },
    });
  }

  recordParsedPayload(payload: AgentRunPayload): void {
    const outline = this.span.startObservation(
      "agent-output.outline",
      {
        output: payload.outline,
        metadata: {
          themeCount: payload.outline.themes.length,
          sectionCount: payload.outline.sections.length,
          mustIncludeCount: payload.outline.mustIncludeCandidateIds.length,
          excludedCount: payload.outline.excludedCandidateIds.length,
        },
      },
      { asType: "span" },
    );
    outline.end();

    const draft = this.span.startObservation(
      "agent-output.draft",
      {
        output: summarizeDraft(payload.draft),
        metadata: {
          sectionCount: payload.draft.sections.length,
          finalTextLength: payload.draft.finalTtsText.length,
        },
      },
      { asType: "generation" },
    );
    draft.end();
  }

  recordError(error: unknown): void {
    this.span.update({
      level: "ERROR",
      statusMessage: errorMessage(error),
      output: {
        status: "error",
        error: errorMessage(error),
      },
    });
  }

  end(): void {
    this.recordStreamSummary();
    for (const tool of this.toolCalls.values()) {
      tool.observation.update({
        output: { status: "incomplete" },
        level: "WARNING",
        statusMessage: "incomplete",
        metadata: { status: "incomplete" },
      });
      tool.observation.end();
    }
    this.toolCalls.clear();
    this.span.end();
  }

  private recordStreamSummary(): void {
    const totalEvents = Object.values(this.streamSummary.counts).reduce((sum, count) => sum + count, 0);
    if (totalEvents === 0) return;

    const summary = this.span.startObservation(
      "cursor-events.summary",
      {
        output: {
          counts: this.streamSummary.counts,
          assistantText: truncate(this.streamSummary.assistantText.join(""), 12000),
          thinkingText: truncate(this.streamSummary.thinkingText.join(""), 8000),
          statuses: this.streamSummary.statuses,
          tasks: this.streamSummary.tasks,
          requests: this.streamSummary.requests,
        },
        metadata: {
          totalEvents,
          assistantEventCount: this.streamSummary.counts.assistant ?? 0,
          thinkingEventCount: this.streamSummary.counts.thinking ?? 0,
        },
      },
      { asType: "event" },
    );
    summary.end();
  }

  private recordDelta(update: unknown): void {
    this.deltaCount += 1;
    if (isRecord(update) && update.type === "turn-ended" && isRecord(update.usage)) {
      this.usageDetails = {
        input: numberField(update.usage.inputTokens),
        output: numberField(update.usage.outputTokens),
        cacheRead: numberField(update.usage.cacheReadTokens),
        cacheWrite: numberField(update.usage.cacheWriteTokens),
      };
    }
  }

  private recordStep(_step: unknown): void {
    this.stepCount += 1;
  }

  private recordToolCall(event: Extract<SDKMessage, { type: "tool_call" }>): void {
    const toolName = displayToolName(event);
    this.toolNames.add(toolName);
    let tool = this.toolCalls.get(event.call_id);
    if (!tool) {
      const observation = this.span.startObservation(
        `tool.${toolName}`,
        {
          input: {
            args: event.args,
            callId: event.call_id,
          },
          metadata: {
            runId: event.run_id,
            status: event.status,
            truncated: event.truncated,
            sdkToolName: event.name,
          },
        },
        { asType: "tool" },
      );
      tool = { observation, name: toolName };
      this.toolCalls.set(event.call_id, tool);
    }

    tool.observation.update({
      output: {
        status: event.status,
        result: summarizeToolResult(event.result),
        truncated: event.truncated,
      },
      metadata: {
        status: event.status,
        truncated: event.truncated,
        sdkToolName: event.name,
      },
      level: event.status === "error" ? "ERROR" : "DEFAULT",
      statusMessage: event.status,
    });

    if (event.status !== "running") {
      tool.observation.end();
      this.toolCalls.delete(event.call_id);
    }
  }
}

function displayToolName(event: Extract<SDKMessage, { type: "tool_call" }>): string {
  if (event.name !== "mcp" || !isRecord(event.args)) return event.name;
  const provider = typeof event.args.providerIdentifier === "string" ? event.args.providerIdentifier : "mcp";
  const toolName = typeof event.args.toolName === "string" ? event.args.toolName : "unknown";
  return `${provider}.${toolName}`;
}

function summarizeDraft(draft: AgentRunPayload["draft"]): Record<string, unknown> {
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

function summarizeToolResult(value: unknown): unknown {
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

type StreamSummary = {
  counts: Record<string, number>;
  assistantText: string[];
  thinkingText: string[];
  statuses: Array<{ status: string; message?: string }>;
  tasks: Array<{ status?: string; text?: string }>;
  requests: Array<{ requestId: string }>;
};

function createStreamSummary(): StreamSummary {
  return {
    counts: {},
    assistantText: [],
    thinkingText: [],
    statuses: [],
    tasks: [],
    requests: [],
  };
}

function appendStreamEvent(summary: StreamSummary, event: SDKMessage): void {
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

function redactSecrets(data: unknown): unknown {
  if (typeof data === "string") {
    return data
      .replace(/cursor_[A-Za-z0-9_-]+/g, "cursor_***")
      .replace(/sk-lf-[A-Za-z0-9_-]+/g, "sk-lf-***")
      .replace(/pk-lf-[A-Za-z0-9_-]+/g, "pk-lf-***");
  }
  return data;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberField(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
