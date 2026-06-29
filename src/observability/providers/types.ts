import type { Tracer } from "@opentelemetry/api";

export type TracingProviderName = "langfuse" | "traceroot" | "laminar";

export interface TracingBackend {
  readonly provider: TracingProviderName;
  getTracer(): Tracer;
  start(): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
