import type { AgentOptions, Run, RunOperation, RunResult, RunStatus, SDKAgent, SDKUserMessage, SendOptions } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import type { AgentClient } from "../src/agent/types.js";
import type { SourceProcessingResult, SourcePolicy } from "../src/domain/types.js";
import {
  applyModelJudgments,
  buildModelOperationRequests,
  CursorSdkModelOperationEnhancer,
} from "../src/model/model-operation-enhancer.js";
import { parseModelOperationBatch } from "../src/model/model-operation-schemas.js";

describe("model operation schemas", () => {
  it("parses typed model operation judgments instead of opaque schema strings", () => {
    const judgments = parseModelOperationBatch(JSON.stringify({
      judgments: [
        {
          schema: "ModelRelevanceJudgment",
          operationId: "model_email_relevance_and_exclusions",
          candidateId: "em_019",
          action: "drop",
          reason: "Crypto price movement is excluded.",
          confidence: 0.94,
        },
      ],
    }));

    expect(judgments[0]).toMatchObject({ schema: "ModelRelevanceJudgment", action: "drop" });
  });

  it("drops invented topic tags from model relevance judgments", () => {
    const judgments = parseModelOperationBatch(JSON.stringify({
      judgments: [
        {
          schema: "ModelRelevanceJudgment",
          operationId: "model_news_relevance",
          candidateId: "news_001",
          action: "keep",
          reason: "Company launch is relevant.",
          confidence: 0.9,
          topicTags: ["company_launch", "payments", "made_up_tag"],
        },
      ],
    }));

    expect(judgments[0]).toMatchObject({ schema: "ModelRelevanceJudgment", topicTags: ["company_launch"] });
  });
});

describe("ModelOperationEnhancer", () => {
  it("applies model judgments before candidates reach the briefing agent", () => {
    const result = sourceResult();

    const enhanced = applyModelJudgments(result, [
      {
        schema: "ModelRelevanceJudgment",
        operationId: "model_email_relevance_and_exclusions",
        candidateId: "em_019",
        action: "drop",
        reason: "Crypto price movement is excluded.",
        confidence: 0.94,
      },
      {
        schema: "ModelBriefingValueJudgment",
        operationId: "model_news_briefing_value",
        candidateId: "news_002",
        scoreDelta: 12,
        reason: "PSD three directly affects checkout work.",
        confidence: 0.88,
      },
    ]);

    expect(enhanced.candidates.map((candidate) => candidate.id)).not.toContain("em_019");
    expect(enhanced.discarded).toContainEqual({ id: "em_019", sourceType: "email", reason: "Crypto price movement is excluded." });
    expect(enhanced.candidates.find((candidate) => candidate.id === "news_002")).toEqual(
      expect.objectContaining({
        modelJudgments: expect.arrayContaining([expect.objectContaining({ schema: "ModelBriefingValueJudgment" })]),
      }),
    );
    expect(enhanced.candidates.find((candidate) => candidate.id === "news_002")?.score.value).toBe(22);
  });

  it("keeps must-include rule candidates when a model tries to drop them", () => {
    const result = sourceResult();

    const enhanced = applyModelJudgments(result, [
      {
        schema: "ModelRelevanceJudgment",
        operationId: "model_news_semantic_exclusions",
        candidateId: "news_001",
        action: "drop",
        reason: "Fintech launch has no AI or LLM product angle.",
        confidence: 0.91,
      },
    ]);

    const candidate = enhanced.candidates.find((value) => value.id === "news_001");
    expect(candidate).toEqual(expect.objectContaining({ id: "news_001", mustInclude: true }));
    expect(candidate?.modelJudgments).toEqual([]);
    expect(enhanced.discarded).not.toContainEqual({
      id: "news_001",
      sourceType: "news",
      reason: "Fintech launch has no AI or LLM product angle.",
    });
  });

  it("runs a separate no-tool Cursor agent to produce source judgments", async () => {
    const client = new FakeAgentClient(JSON.stringify({
      judgments: [
        {
          schema: "ModelRelevanceJudgment",
          operationId: "model_email_relevance_and_exclusions",
          candidateId: "em_019",
          action: "drop",
          reason: "Crypto price movement is excluded.",
          confidence: 0.94,
        },
      ],
    }));
    const enhancer = new CursorSdkModelOperationEnhancer(client, {
      apiKey: "cursor_test",
      model: "composer-2.5",
      cwd: process.cwd(),
    });

    const enhanced = await enhancer.enhance(sourceResult(), sourcePolicy());

    expect(client.createOptions?.mcpServers).toBeUndefined();
    expect(client.createOptions?.local).toEqual({ cwd: process.cwd(), settingSources: [] });
    expect(client.agent.messages[0]).toContain("You do not have tools");
    expect(enhanced.candidates.map((candidate) => candidate.id)).not.toContain("em_019");
  });

  it("builds model requests from policy operations and matching candidates", () => {
    const requests = buildModelOperationRequests(sourceResult().candidates, sourcePolicy());

    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: expect.objectContaining({ id: "model_email_relevance_and_exclusions" }),
        candidate: expect.objectContaining({ id: "em_019" }),
      }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: "model_news_briefing_value" }),
        candidate: expect.objectContaining({ id: "news_002" }),
      }),
    ]));
  });
});

function sourcePolicy(): SourcePolicy {
  return {
    sourceType: "email",
    operations: [
      {
        type: "model",
        id: "model_email_relevance_and_exclusions",
        when: { field: "sourceType", op: "equals", value: "email" },
        task: "classify_relevance",
        outputSchema: "ModelRelevanceJudgment",
        prompt: "Drop excluded crypto price movement.",
      },
      {
        type: "model",
        id: "model_news_briefing_value",
        when: { field: "sourceType", op: "equals", value: "news" },
        task: "score_briefing_value",
        outputSchema: "ModelBriefingValueJudgment",
        prompt: "Score PSD three relevance.",
      },
    ],
  };
}

function sourceResult(): SourceProcessingResult {
  return {
    discarded: [],
    candidates: [
      {
        id: "news_001",
        sourceType: "news",
        title: "Cobalt Labs launches payments platform",
        topicTags: ["company_launch"],
        score: {
          value: 60,
          reasons: [
            {
              source: "rule",
              label: "boost_cobalt",
              reason: "Cobalt Labs is the user's company and launch news should always be surfaced.",
              delta: 50,
            },
          ],
        },
        mustInclude: true,
        filterReasons: [],
        modelJudgments: [],
        speakableFacts: [{ raw: "Cobalt Labs launch.", spoken: "Cobalt Labs launch." }],
        restrictedFacts: [],
        originalItemIds: ["news_001"],
      },
      {
        id: "em_019",
        sourceType: "email",
        title: "Bitcoin breaks two hundred thousand dollars",
        topicTags: [],
        score: { value: 10, reasons: [] },
        mustInclude: false,
        filterReasons: [],
        modelJudgments: [],
        speakableFacts: [{ raw: "Bitcoin price movement.", spoken: "Bitcoin price movement." }],
        restrictedFacts: [],
        originalItemIds: ["em_019"],
      },
      {
        id: "news_002",
        sourceType: "news",
        title: "EU publishes final PSD three text",
        topicTags: ["psd3"],
        score: { value: 10, reasons: [] },
        mustInclude: false,
        filterReasons: [],
        modelJudgments: [],
        speakableFacts: [{ raw: "PSD three affects checkout.", spoken: "PSD three affects checkout." }],
        restrictedFacts: [],
        originalItemIds: ["news_002"],
      },
    ],
  };
}

class FakeAgentClient implements AgentClient {
  readonly agent: FakeAgent;
  createOptions?: AgentOptions;

  constructor(result: string) {
    this.agent = new FakeAgent(result);
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

  constructor(private readonly result: string) {}

  async send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run> {
    this.messages.push(typeof message === "string" ? message : message.text);
    return new FakeRun(this.result, options);
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

  constructor(private readonly text: string, private readonly options?: SendOptions) {}

  get status(): RunStatus {
    return "finished";
  }

  async *stream() {
    await this.options?.onDelta?.({ update: { type: "turn-ended", usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  }
  async wait(): Promise<RunResult> {
    return { id: this.id, status: "finished", result: this.text };
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
