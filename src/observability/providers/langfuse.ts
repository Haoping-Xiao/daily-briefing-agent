import { LangfuseSpanProcessor } from "@langfuse/otel";
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { redactSecrets } from "../tracing-utils.js";
import type { TracingBackend } from "./types.js";

export function createLangfuseBackend(env: NodeJS.ProcessEnv = process.env): TracingBackend | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = env.LANGFUSE_BASE_URL?.trim();

  if (!publicKey || !secretKey) {
    return null;
  }

  const spanProcessor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: baseUrl || undefined,
    mask: ({ data }) => redactSecrets(data),
  });
  const sdk = new NodeSDK({
    spanProcessors: [spanProcessor],
  });

  return {
    provider: "langfuse",
    getTracer() {
      return trace.getTracer("daily-briefing-agent", "1.0.0");
    },
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
