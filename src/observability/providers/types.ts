export type TracingProviderName = "langfuse" | "traceroot";

export interface TracingBackend {
  readonly provider: TracingProviderName;
  start(): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
