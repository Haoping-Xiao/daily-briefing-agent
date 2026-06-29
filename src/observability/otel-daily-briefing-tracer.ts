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
import { startObservationHandle, type ObservationHandle } from "./observation-handle.js";
import type { TracingBackend } from "./providers/types.js";
import {
  appendStreamEvent,
  createStreamSummary,
  displayToolName,
  errorMessage,
  isRecord,
  numberField,
  summarizeDraft,
  summarizeToolResult,
  truncate,
} from "./tracing-utils.js";

export class OtelDailyBriefingTracer implements DailyBriefingTracer {
  constructor(private readonly backend: TracingBackend) {}

  startTrace(input: DailyBriefingTraceInput): DailyBriefingTrace {
    const root = startObservationHandle(
      this.backend.provider,
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
      "agent",
    );
    return new OtelDailyBriefingTrace(root, input);
  }

  async flush(): Promise<void> {
    await this.backend.flush();
  }

  async shutdown(): Promise<void> {
    await this.backend.shutdown();
  }
}

class OtelDailyBriefingTrace implements DailyBriefingTrace {
  private readonly startedAt = Date.now();
  private validationIssueCount = 0;

  constructor(
    private readonly root: ObservationHandle,
    private readonly input: DailyBriefingTraceInput,
  ) {}

  recordSourceProcessing(summary: SourceProcessingObservation): void {
    const span = this.root.startChild(
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
      "retriever",
    );
    span.end();
  }

  startAgentRun(input: AgentRunTraceInput): AgentRunTrace {
    return new OtelAgentRunTrace(this.root, input);
  }

  recordValidationAttempt(summary: ValidationAttemptObservation): void {
    this.validationIssueCount += summary.issueCount;
    const span = this.root.startChild(
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
      "evaluator",
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

class OtelAgentRunTrace implements AgentRunTrace {
  readonly sendOptions: SendOptions = {
    onDelta: ({ update }) => {
      this.recordDelta(update);
    },
    onStep: ({ step }) => {
      this.recordStep(step);
    },
  };

  private readonly span: ObservationHandle;
  private readonly toolCalls = new Map<string, { observation: ObservationHandle; name: string }>();
  private readonly toolNames = new Set<string>();
  private usageDetails: Record<string, number> | undefined;
  private deltaCount = 0;
  private stepCount = 0;
  private readonly streamSummary = createStreamSummary();

  constructor(
    parent: ObservationHandle,
    private readonly input: AgentRunTraceInput,
  ) {
    this.span = parent.startChild(
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
      "agent",
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
    const outline = this.span.startChild(
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
      "span",
    );
    outline.end();

    const draft = this.span.startChild(
      "agent-output.draft",
      {
        output: summarizeDraft(payload.draft),
        metadata: {
          sectionCount: payload.draft.sections.length,
          finalTextLength: payload.draft.finalTtsText.length,
        },
      },
      "generation",
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

    const summary = this.span.startChild(
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
      "event",
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
      const observation = this.span.startChild(
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
        "tool",
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
