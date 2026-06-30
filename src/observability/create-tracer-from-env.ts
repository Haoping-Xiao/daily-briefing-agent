import { NoopDailyBriefingTracer, type DailyBriefingTracer } from "./daily-briefing-tracer.js";
import { OtelDailyBriefingTracer } from "./otel-daily-briefing-tracer.js";
import { createBraintrustBackend } from "./providers/braintrust.js";
import { createLaminarBackend } from "./providers/laminar.js";
import { createLangfuseBackend } from "./providers/langfuse.js";
import { createTraceRootBackend } from "./providers/traceroot.js";
import type { TracingBackend, TracingProviderName } from "./providers/types.js";

function normalizeTracingProvider(raw: string): TracingProviderName | null {
  if (raw === "lmnr") {
    return "laminar";
  }
  if (raw === "bt") {
    return "braintrust";
  }
  if (raw === "langfuse" || raw === "traceroot" || raw === "laminar" || raw === "braintrust") {
    return raw;
  }
  return null;
}

export function resolveTracingProvider(env: NodeJS.ProcessEnv = process.env): TracingProviderName | "noop" {
  const raw = (env.TRACING_PROVIDER ?? "langfuse").trim().toLowerCase();
  const provider = normalizeTracingProvider(raw);
  if (provider) {
    return provider;
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
  if (provider === "laminar") {
    return createLaminarBackend(env);
  }
  if (provider === "braintrust") {
    return createBraintrustBackend(env);
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
