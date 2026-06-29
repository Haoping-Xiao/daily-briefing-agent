import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createIsolatedOtelBackend } from "./otel-isolated-backend.js";
import type { TracingBackend } from "./types.js";

const DEFAULT_BASE_URL = "https://api.lmnr.ai";

export function createLaminarBackend(env: NodeJS.ProcessEnv = process.env): TracingBackend | null {
  const apiKey = env.LMNR_PROJECT_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const baseUrl = (env.LMNR_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const exporter = new OTLPTraceExporter({
    url: `${baseUrl}/v1/traces`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const spanProcessor = new BatchSpanProcessor(exporter);
  return createIsolatedOtelBackend("laminar", spanProcessor);
}
