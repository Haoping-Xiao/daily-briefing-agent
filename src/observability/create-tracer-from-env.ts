import { NoopDailyBriefingTracer, type DailyBriefingTracer } from "./daily-briefing-tracer.js";
import { OtelDailyBriefingTracer } from "./otel-daily-briefing-tracer.js";
import { createLangfuseBackend } from "./providers/langfuse.js";
import { createTraceRootBackend } from "./providers/traceroot.js";
import type { TracingBackend, TracingProviderName } from "./providers/types.js";

export function resolveTracingProvider(env: NodeJS.ProcessEnv = process.env): TracingProviderName | "noop" {
  const raw = (env.TRACING_PROVIDER ?? "langfuse").trim().toLowerCase();
  if (raw === "langfuse" || raw === "traceroot") {
    return raw;
  }
  if (raw === "noop" || raw === "none" || raw === "off" || raw === "false" || raw === "disabled") {
    return "noop";
  }
  return "noop";
}

function createBackend(provider: TracingProviderName, env: NodeJS.ProcessEnv): TracingBackend | null {
  if (provider === "langfuse") {
    return createLangfuseBackend(env);
  }
  return createTraceRootBackend(env);
}

export function createDailyBriefingTracerFromEnv(env: NodeJS.ProcessEnv = process.env): DailyBriefingTracer {
  const provider = resolveTracingProvider(env);
  if (provider === "noop") {
    return new NoopDailyBriefingTracer();
  }

  try {
    const backend = createBackend(provider, env);
    if (!backend) {
      return new NoopDailyBriefingTracer();
    }
    backend.start();
    return new OtelDailyBriefingTracer(backend);
  } catch {
    return new NoopDailyBriefingTracer();
  }
}

/** @deprecated Use createDailyBriefingTracerFromEnv() with TRACING_PROVIDER=langfuse */
export function createLangfuseDailyBriefingTracerFromEnv(env: NodeJS.ProcessEnv = process.env): DailyBriefingTracer {
  return createDailyBriefingTracerFromEnv({
    ...env,
    TRACING_PROVIDER: "langfuse",
  });
}
