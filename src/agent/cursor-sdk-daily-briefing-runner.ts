import { CursorAgentError, type McpServerConfig, type SDKAgent } from "@cursor/sdk";
import { resolve } from "node:path";
import { buildInitialPrompt, buildRevisionPrompt } from "./prompts.js";
import { parseAgentRunPayload } from "./result-parser.js";
import type { AgentClient, CursorSdkRuntimeOptions, DailyBriefingRunInput, DailyBriefingRunResult } from "./types.js";
import type { ValidationIssue } from "../domain/types.js";
import { CursorSdkModelOperationEnhancer } from "../model/model-operation-enhancer.js";
import { NoopDailyBriefingTracer, summarizeSourceProcessing, type DailyBriefingTrace, type DailyBriefingTracer } from "../observability/daily-briefing-tracer.js";
import { createSourceRuntime } from "../pipeline/source-runtime.js";

export interface DailyBriefingValidator {
  validate(result: DailyBriefingRunResult): Promise<ValidationIssue[]>;
}

export class CursorSdkDailyBriefingRunner {
  constructor(
    private readonly options: CursorSdkRuntimeOptions,
    private readonly client: AgentClient,
    private readonly validators: DailyBriefingValidator[] = [],
    private readonly tracer: DailyBriefingTracer = new NoopDailyBriefingTracer(),
  ) {}

  async run(input: DailyBriefingRunInput): Promise<DailyBriefingRunResult> {
    const trace = this.tracer.startTrace({
      briefingDate: input.briefingDate,
      inputDir: input.inputDir,
      model: this.options.model,
      maxRevisions: this.options.maxRevisions,
    });
    const sourceRuntime = await createSourceRuntime(input.inputDir, {
      modelOperationEnhancer: new CursorSdkModelOperationEnhancer(this.client, {
        apiKey: this.options.apiKey,
        model: this.options.model,
        cwd: this.options.cwd,
      }),
    });
    const sourceResults = await sourceRuntime.runAllTools();
    trace.recordSourceProcessing(summarizeSourceProcessing(sourceResults));
    const candidates = Object.values(sourceResults).flatMap((result) => result.candidates);
    const discardedInputItems = Object.values(sourceResults).flatMap((result) => result.discarded);

    let agent: SDKAgent | undefined;
    let revisionCount = 0;
    try {
      agent = await this.client.create({
        apiKey: this.options.apiKey,
        model: { id: this.options.model },
        local: {
          cwd: this.options.cwd,
          settingSources: [],
        },
        mcpServers: {
          "daily-briefing-sources": this.mcpServerConfig(input.inputDir, candidates),
        },
      });

      const firstPayload = await this.sendAndParse(
        trace,
        agent,
        buildInitialPrompt({
          briefingDate: input.briefingDate,
          inputDir: input.inputDir,
          context: input.context,
          candidates,
        }),
        "initial",
        0,
      );

      let current: DailyBriefingRunResult = {
        ...firstPayload,
        outline: {
          ...firstPayload.outline,
          discardedInputItems,
        },
        candidates,
        sourceResults,
        validationIssues: [],
      };

      for (let attempt = 0; attempt <= this.options.maxRevisions; attempt += 1) {
        const issues = await this.validate(current);
        trace.recordValidationAttempt({ attempt, issueCount: issues.length, issues });
        if (issues.length === 0) {
          const final = { ...current, validationIssues: [] };
          trace.recordFinalResult({ outline: final.outline, draft: final.draft, revisionCount });
          return final;
        }
        current = { ...current, validationIssues: issues };
        if (attempt === this.options.maxRevisions) {
          throw new Error(`Briefing failed validation after ${this.options.maxRevisions} revision attempts.`);
        }
        revisionCount += 1;
        const revised = await this.sendAndParse(
          trace,
          agent,
          buildRevisionPrompt({ briefingDate: input.briefingDate, validationIssues: issues, candidates }),
          "revision",
          revisionCount,
        );
        current = {
          ...current,
          ...revised,
          outline: {
            ...revised.outline,
            discardedInputItems,
          },
        };
      }

      return current;
    } catch (error) {
      if (error instanceof CursorAgentError) {
        trace.recordError(error);
        throw new Error(`Cursor SDK startup failed: ${error.message}`);
      }
      trace.recordError(error);
      throw error;
    } finally {
      if (agent) {
        await agent[Symbol.asyncDispose]();
      }
      trace.end();
      await this.tracer.flush();
    }
  }

  private async sendAndParse(trace: DailyBriefingTrace, agent: SDKAgent, prompt: string, kind: "initial" | "revision", attempt: number) {
    const agentRun = trace.startAgentRun({
      kind,
      attempt,
      prompt,
      agentId: agent.agentId,
      model: this.options.model,
    });
    try {
      const run = await agent.send(prompt, agentRun.sendOptions);
      for await (const event of run.stream()) {
        agentRun.recordStreamEvent(event);
      }
      const result = await run.wait();
      agentRun.recordRunResult(result);
      if (result.status !== "finished") {
        throw new Error(`Cursor SDK run ${result.id} ended with status ${result.status}.`);
      }
      const payload = parseAgentRunPayload(result.result);
      agentRun.recordParsedPayload(payload);
      return payload;
    } catch (error) {
      agentRun.recordError(error);
      throw error;
    } finally {
      agentRun.end();
    }
  }

  private async validate(result: DailyBriefingRunResult): Promise<ValidationIssue[]> {
    const nested = await Promise.all(this.validators.map((validator) => validator.validate(result)));
    return nested.flat().filter((issue) => issue.severity === "error");
  }

  private mcpServerConfig(inputDir: string, candidates: DailyBriefingRunResult["candidates"]): McpServerConfig {
    return {
      type: "stdio",
      command: process.execPath,
      args: [resolve(this.options.cwd, "node_modules/tsx/dist/cli.mjs"), "src/mcp/daily-briefing-tools.ts"],
      cwd: this.options.cwd,
      env: {
        ...definedProcessEnv(),
        DAILY_BRIEFING_INPUT_DIR: inputDir,
        DAILY_BRIEFING_MODEL_OPS_ENABLED: "true",
        DAILY_BRIEFING_MODEL: this.options.model,
        DAILY_BRIEFING_CWD: this.options.cwd,
        DAILY_BRIEFING_CANDIDATES_JSON: JSON.stringify(candidates),
      },
    };
  }
}

function definedProcessEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
