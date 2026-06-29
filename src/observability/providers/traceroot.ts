import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, type ReadableSpan, type Span, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { Context } from "@opentelemetry/api";
import type { TracingBackend } from "./types.js";

const DEFAULT_HOST = "https://app.traceroot.ai";
const APP_TRACER_NAME = "daily-briefing-agent";

export function createTraceRootBackend(env: NodeJS.ProcessEnv = process.env): TracingBackend | null {
  const apiKey = env.TRACEROOT_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const host = (env.TRACEROOT_HOST_URL?.trim() || DEFAULT_HOST).replace(/\/$/, "");
  const exporter = new OTLPTraceExporter({
    url: `${host}/api/v1/public/traces`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const spanProcessor = new AppScopedSpanProcessor(new BatchSpanProcessor(exporter));
  const sdk = new NodeSDK({
    spanProcessors: [spanProcessor],
  });

  return {
    provider: "traceroot",
    start() {
      sdk.start();
    },
    async flush() {
      try {
        await spanProcessor.forceFlush();
      } catch {}
    },
    async shutdown() {
      try {
        await sdk.shutdown();
      } catch {}
    },
  };
}

/**
 * Forwards only spans emitted by this app's tracer to the wrapped processor.
 * Third-party spans (e.g. the Cursor Agent SDK's internal git cache-warming spans)
 * do not carry `traceroot.span.*` attributes, so they surface in TraceRoot with
 * null input/output. Dropping them at export keeps traces clean and avoids
 * false-positive "missing data" alerts.
 */
class AppScopedSpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  private isAppSpan(span: ReadableSpan): boolean {
    return span.instrumentationScope.name === APP_TRACER_NAME;
  }

  onStart(span: Span, parentContext: Context): void {
    if (this.isAppSpan(span)) this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (this.isAppSpan(span)) this.delegate.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
