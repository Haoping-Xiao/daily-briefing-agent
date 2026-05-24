import type { AgentOptions, Run, RunOperation, RunResult, RunStatus, SDKAgent, SDKMessage, SDKUserMessage, SendOptions } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import { CursorSdkDailyBriefingRunner, type DailyBriefingValidator } from "../src/agent/cursor-sdk-daily-briefing-runner.js";
import type { AgentClient } from "../src/agent/types.js";
import type { AgentRunTrace, DailyBriefingTrace, DailyBriefingTracer } from "../src/observability/daily-briefing-tracer.js";
import { createSourceRuntime } from "../src/pipeline/source-runtime.js";

describe("CursorSdkDailyBriefingRunner", () => {
  it("creates a local Cursor SDK agent with inline stdio MCP config and waits for a run", async () => {
    const runtime = await createSourceRuntime("inputs");
    const client = new FakeAgentClient([...modelOperationResults(), JSON.stringify(agentPayload())]);
    const runner = new CursorSdkDailyBriefingRunner(
      { apiKey: "cursor_test", model: "composer-2.5", cwd: process.cwd(), maxRevisions: 0 },
      client,
    );

    const result = await runner.run({
      context: runtime.policy.briefGenerationContext,
      briefingDate: "2026-05-15",
      inputDir: "inputs",
    });

    expect(client.createOptions?.local).toEqual({ cwd: process.cwd(), settingSources: [] });
    expect(client.createOptions?.mcpServers?.["daily-briefing-sources"]).toEqual(
      expect.objectContaining({
        type: "stdio",
        command: process.execPath,
        args: [expect.stringContaining("node_modules/tsx/dist/cli.mjs"), "src/mcp/daily-briefing-tools.ts"],
        env: expect.objectContaining({
          DAILY_BRIEFING_INPUT_DIR: "inputs",
          DAILY_BRIEFING_MODEL_OPS_ENABLED: "true",
          DAILY_BRIEFING_MODEL: "composer-2.5",
          DAILY_BRIEFING_CWD: process.cwd(),
          DAILY_BRIEFING_CANDIDATES_JSON: expect.any(String),
          PATH: process.env.PATH,
        }),
      }),
    );
    expect(client.agent.disposed).toBe(true);
    expect(client.agent.messages[0]).toContain("You do not have tools");
    expect(client.agent.messages[2]).toContain("candidate_search");
    expect(client.agent.messages[2]).not.toContain("Input data directory: inputs");
    expect(client.agent.messages[2]).toContain("Candidate corpus size:");
    expect(client.agent.messages[2]).toContain("Search results have already been filtered, scored, and privacy-reviewed");
    expect(client.agent.messages[2]).not.toContain("clustered by source processing");
    expect(result.draft.finalTtsText).toContain("Cobalt");
  });

  it("sends a revision prompt on validation failure", async () => {
    const runtime = await createSourceRuntime("inputs");
    const validator: DailyBriefingValidator = {
      calls: 0,
      async validate() {
        this.calls += 1;
        return this.calls === 1 ? [{ validator: "test", severity: "error", message: "Fix duration." }] : [];
      },
    } as DailyBriefingValidator & { calls: number };
    const client = new FakeAgentClient([...modelOperationResults(), JSON.stringify(agentPayload("too short")), JSON.stringify(agentPayload("revised Cobalt briefing"))]);
    const runner = new CursorSdkDailyBriefingRunner(
      { apiKey: "cursor_test", model: "composer-2.5", cwd: process.cwd(), maxRevisions: 1 },
      client,
      [validator],
    );

    const result = await runner.run({
      context: runtime.policy.briefGenerationContext,
      briefingDate: "2026-05-15",
      inputDir: "inputs",
    });

    expect(client.agent.messages).toHaveLength(4);
    expect(client.agent.messages[3]).toContain("Validation issues");
    expect(result.draft.finalTtsText).toBe("revised Cobalt briefing");
  });

  it("does not write through run errors as successful drafts", async () => {
    const runtime = await createSourceRuntime("inputs");
    const client = new FakeAgentClient(modelOperationResults(), ["finished", "finished", "error"]);
    const runner = new CursorSdkDailyBriefingRunner(
      { apiKey: "cursor_test", model: "composer-2.5", cwd: process.cwd(), maxRevisions: 0 },
      client,
    );

    await expect(
      runner.run({
        context: runtime.policy.briefGenerationContext,
        briefingDate: "2026-05-15",
        inputDir: "inputs",
      }),
    ).rejects.toThrow(/ended with status error/);
  });

  it("records source processing, tool calls, parsed output, and validation attempts", async () => {
    const runtime = await createSourceRuntime("inputs");
    const tracer = new RecordingTracer();
    const toolCall: SDKMessage = {
      type: "tool_call",
      agent_id: "agent-test",
      run_id: "run-test",
      call_id: "call-1",
      name: "candidate_search",
      status: "completed",
      args: { briefingDate: "2026-05-15", query: "Cobalt" },
      result: { results: [{ id: "news_001", score: { value: 60 } }] },
    };
    const client = new FakeAgentClient([...modelOperationResults(), JSON.stringify(agentPayload())], "finished", [toolCall]);
    const runner = new CursorSdkDailyBriefingRunner(
      { apiKey: "cursor_test", model: "composer-2.5", cwd: process.cwd(), maxRevisions: 0 },
      client,
      [],
      tracer,
    );

    const result = await runner.run({
      context: runtime.policy.briefGenerationContext,
      briefingDate: "2026-05-15",
      inputDir: "inputs",
    });

    expect(result.draft.finalTtsText).toContain("Cobalt");
    expect(tracer.trace?.sourceProcessing?.sources.news.candidateCount).toBeGreaterThan(0);
    expect(tracer.trace?.sourceProcessing?.sources.news.discardedCount).toBeGreaterThan(0);
    expect(tracer.trace?.agentRuns[0]?.streamEvents).toContainEqual(expect.objectContaining({ type: "tool_call", name: "candidate_search" }));
    expect(tracer.trace?.agentRuns[0]?.parsedPayload?.outline.mustIncludeCandidateIds).toContain("news_001");
    expect(tracer.trace?.validationAttempts[0]).toEqual(expect.objectContaining({ attempt: 0, issueCount: 0 }));
    expect(tracer.trace?.finalResult?.draft.finalTtsText).toContain("Cobalt");
    expect(tracer.trace?.ended).toBe(true);
  });
});

class FakeAgentClient implements AgentClient {
  readonly agent: FakeAgent;
  createOptions?: AgentOptions;

  constructor(results: string[], status: RunResult["status"] | RunResult["status"][] = "finished", streamEvents: SDKMessage[] = []) {
    this.agent = new FakeAgent(results, Array.isArray(status) ? status : undefined, Array.isArray(status) ? "finished" : status, streamEvents);
  }

  async create(options: AgentOptions): Promise<SDKAgent> {
    this.createOptions = options;
    return this.agent;
  }
}

class FakeAgent implements SDKAgent {
  readonly agentId = "agent-test";
  readonly model = { id: "composer-2.5" };
  readonly messages: string[] = [];
  disposed = false;

  constructor(
    private readonly results: string[],
    private readonly statuses: RunResult["status"][] | undefined,
    private readonly defaultStatus: RunResult["status"],
    private readonly streamEvents: SDKMessage[],
  ) {}

  async send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run> {
    this.messages.push(typeof message === "string" ? message : message.text);
    return new FakeRun(this.results.shift(), this.statuses?.shift() ?? this.defaultStatus, this.streamEvents, options);
  }

  close(): void {}
  async reload(): Promise<void> {}
  async [Symbol.asyncDispose](): Promise<void> {
    this.disposed = true;
  }
  async listArtifacts() {
    return [];
  }
  async downloadArtifact() {
    return Buffer.from("");
  }
}

class FakeRun implements Run {
  readonly id = "run-test";
  readonly agentId = "agent-test";
  readonly result = undefined;
  readonly model = undefined;
  readonly durationMs = undefined;
  readonly git = undefined;

  constructor(
    private readonly text: string | undefined,
    private readonly finalStatus: RunResult["status"],
    private readonly streamEvents: SDKMessage[],
    private readonly options?: SendOptions,
  ) {}

  get status(): RunStatus {
    return this.finalStatus;
  }

  async *stream() {
    await this.options?.onDelta?.({ update: { type: "turn-ended", usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    for (const event of this.streamEvents) {
      yield event;
    }
  }
  async wait(): Promise<RunResult> {
    return { id: this.id, status: this.finalStatus, result: this.text };
  }
  async cancel(): Promise<void> {}
  async conversation() {
    return [];
  }
  supports(_operation: RunOperation): boolean {
    return true;
  }
  unsupportedReason(_operation: RunOperation): string | undefined {
    return undefined;
  }
  onDidChangeStatus(_listener: (status: RunStatus) => void): () => void {
    return () => {};
  }
}

class RecordingTracer implements DailyBriefingTracer {
  trace?: RecordingTrace;

  startTrace(input: Parameters<DailyBriefingTracer["startTrace"]>[0]): DailyBriefingTrace {
    this.trace = new RecordingTrace(input);
    return this.trace;
  }

  async flush(): Promise<void> {}
}

class RecordingTrace implements DailyBriefingTrace {
  readonly agentRuns: RecordingAgentRunTrace[] = [];
  sourceProcessing?: Parameters<DailyBriefingTrace["recordSourceProcessing"]>[0];
  validationAttempts: Parameters<DailyBriefingTrace["recordValidationAttempt"]>[0][] = [];
  finalResult?: Parameters<DailyBriefingTrace["recordFinalResult"]>[0];
  ended = false;

  constructor(readonly input: unknown) {
  }

  recordSourceProcessing(summary: Parameters<DailyBriefingTrace["recordSourceProcessing"]>[0]): void {
    this.sourceProcessing = summary;
  }

  startAgentRun(input: Parameters<DailyBriefingTrace["startAgentRun"]>[0]): AgentRunTrace {
    const run = new RecordingAgentRunTrace(input);
    this.agentRuns.push(run);
    return run;
  }

  recordValidationAttempt(summary: Parameters<DailyBriefingTrace["recordValidationAttempt"]>[0]): void {
    this.validationAttempts.push(summary);
  }

  recordFinalResult(result: Parameters<DailyBriefingTrace["recordFinalResult"]>[0]): void {
    this.finalResult = result;
  }

  recordError(_error: unknown): void {}

  end(): void {
    this.ended = true;
  }
}

class RecordingAgentRunTrace implements AgentRunTrace {
  readonly sendOptions: SendOptions = {
    onDelta: ({ update }) => {
      this.deltas.push(update);
    },
  };
  readonly streamEvents: SDKMessage[] = [];
  readonly deltas: unknown[] = [];
  parsedPayload?: Parameters<AgentRunTrace["recordParsedPayload"]>[0];

  constructor(readonly input: unknown) {}

  recordStreamEvent(event: SDKMessage): void {
    this.streamEvents.push(event);
  }

  recordRunResult(_result: RunResult): void {}

  recordParsedPayload(payload: Parameters<AgentRunTrace["recordParsedPayload"]>[0]): void {
    this.parsedPayload = payload;
  }

  recordError(_error: unknown): void {}

  end(): void {}
}

function agentPayload(text = "Cobalt briefing"): unknown {
  return {
    outline: {
      themes: [],
      sections: [
        {
          id: "opening",
          name: "Opening",
          candidateIds: ["news_001"],
          coveredInputItemIds: { calendar: [], emails: [], news: ["news_001"] },
          targetWords: 20,
        },
      ],
      mustIncludeCandidateIds: ["news_001"],
      excludedCandidateIds: [],
      discardedInputItems: [],
      explorationReasoning: ["Cobalt is must-include."],
    },
    draft: {
      sections: [{ sectionId: "opening", title: "Opening", text, candidateIds: ["news_001"] }],
      fullTextWithSectionMarkers: `## Opening\n${text}`,
      finalTtsText: text,
    },
  };
}

function modelOperationResults(): string[] {
  return Array.from({ length: 2 }, () => JSON.stringify({ judgments: [] }));
}
