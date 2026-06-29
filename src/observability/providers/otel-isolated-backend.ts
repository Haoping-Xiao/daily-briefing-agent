import type { Tracer } from "@opentelemetry/api";
import { BasicTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { TracingBackend, TracingProviderName } from "./types.js";

export function createIsolatedOtelBackend(
  provider: TracingProviderName,
  spanProcessor: SpanProcessor,
): TracingBackend {
  const otelProvider = new BasicTracerProvider({
    spanProcessors: [spanProcessor],
  });
  const tracer = otelProvider.getTracer("daily-briefing-agent", "1.0.0");

  return {
    provider,
    getTracer(): Tracer {
      return tracer;
    },
    start() {},
    async flush() {
      try {
        await spanProcessor.forceFlush();
      } catch {}
    },
    async shutdown() {
      try {
        await otelProvider.shutdown();
      } catch {}
    },
  };
}
