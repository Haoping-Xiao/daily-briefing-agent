import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  resolveTraceRootGitContext,
  warnIfTraceRootGitContextIncomplete,
} from "./traceroot-git-context.js";
import { TraceRootGitSpanProcessor } from "./traceroot-span-processor.js";
import { createIsolatedOtelBackend } from "./otel-isolated-backend.js";
import type { TracingBackend } from "./types.js";

const DEFAULT_HOST = "https://app.traceroot.ai";

export function createTraceRootBackend(env: NodeJS.ProcessEnv = process.env): TracingBackend | null {
  const apiKey = env.TRACEROOT_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const gitContext = resolveTraceRootGitContext(env);
  warnIfTraceRootGitContextIncomplete(gitContext);

  const host = (env.TRACEROOT_HOST_URL?.trim() || DEFAULT_HOST).replace(/\/$/, "");
  const exporter = new OTLPTraceExporter({
    url: `${host}/api/v1/public/traces`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const spanProcessor = new TraceRootGitSpanProcessor(
    new BatchSpanProcessor(exporter),
    gitContext.gitRepo,
    gitContext.gitRef,
  );
  return createIsolatedOtelBackend("traceroot", spanProcessor);
}
