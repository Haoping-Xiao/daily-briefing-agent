import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createIsolatedOtelBackend } from "./otel-isolated-backend.js";
import type { TracingBackend } from "./types.js";

const DEFAULT_API_URL = "https://api.braintrust.dev";

export function resolveBraintrustParent(env: NodeJS.ProcessEnv = process.env): string | null {
  const parent = env.BRAINTRUST_PARENT?.trim();
  if (parent) {
    return parent;
  }

  const projectId = env.BRAINTRUST_PROJECT_ID?.trim();
  if (projectId) {
    return `project_id:${projectId}`;
  }

  return null;
}

export function createBraintrustBackend(env: NodeJS.ProcessEnv = process.env): TracingBackend | null {
  const apiKey = env.BRAINTRUST_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const parent = resolveBraintrustParent(env);
  if (!parent) {
    return null;
  }

  const apiUrl = (env.BRAINTRUST_API_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, "");
  const exporter = new OTLPTraceExporter({
    url: `${apiUrl}/otel/v1/traces`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "x-bt-parent": parent,
    },
  });
  const spanProcessor = new BatchSpanProcessor(exporter);
  return createIsolatedOtelBackend("braintrust", spanProcessor);
}
