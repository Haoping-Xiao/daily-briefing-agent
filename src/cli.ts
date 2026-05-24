import "dotenv/config";
import { HelpRequested, parseCliOptions, requireCursorApiKey } from "./config.js";
import { CursorSdkAgentClient } from "./agent/cursor-sdk-agent-client.js";
import { CursorSdkDailyBriefingRunner } from "./agent/cursor-sdk-daily-briefing-runner.js";
import { createLangfuseDailyBriefingTracerFromEnv } from "./observability/langfuse-tracer.js";
import { writeBriefingOutputs } from "./output/output-writer.js";
import { createSourceRuntime } from "./pipeline/source-runtime.js";
import { HeuristicLlmJudgeValidators } from "./validators/llm-judge-validators.js";
import { RuleValidators } from "./validators/rule-validators.js";

async function main(): Promise<void> {
  const tracer = createLangfuseDailyBriefingTracerFromEnv();
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const apiKey = requireCursorApiKey();
    const sourceRuntime = await createSourceRuntime(options.inputDir);
    const runner = new CursorSdkDailyBriefingRunner(
      {
        apiKey,
        model: options.model,
        cwd: process.cwd(),
        maxRevisions: options.maxRevisions,
      },
      new CursorSdkAgentClient(),
      [new RuleValidators(), new HeuristicLlmJudgeValidators()],
      tracer,
    );
    const result = await runner.run({
      context: sourceRuntime.policy.briefGenerationContext,
      briefingDate: options.briefingDate,
      inputDir: options.inputDir,
    });
    await writeBriefingOutputs(result, {
      textPath: options.outputTextPath,
      jsonPath: options.outputJsonPath,
    });
    console.log(`Wrote ${options.outputTextPath} and ${options.outputJsonPath}.`);
  } catch (error) {
    if (error instanceof HelpRequested) {
      console.log(error.message);
      return;
    }
    throw error;
  } finally {
    await tracer.shutdown?.();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
