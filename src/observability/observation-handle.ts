import { startObservation } from "@langfuse/tracing";
import { context, SpanStatusCode, trace, type Span, type SpanContext } from "@opentelemetry/api";
import type { TracingProviderName } from "./providers/types.js";

export type ObservationType =
  | "agent"
  | "tool"
  | "generation"
  | "retriever"
  | "evaluator"
  | "span"
  | "event";

export type ObservationAttributes = {
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
};

export interface ObservationHandle {
  update(attributes: ObservationAttributes & Record<string, unknown>): void;
  end(): void;
  startChild(name: string, attributes: ObservationAttributes, asType: ObservationType): ObservationHandle;
}

type LangfuseObservation = {
  update(attributes: Record<string, unknown>): LangfuseObservation;
  end(): void;
  startObservation(
    name: string,
    attributes?: Record<string, unknown>,
    options?: { asType: string },
  ): LangfuseObservation;
};

const OTEL_TRACER = trace.getTracer("daily-briefing-agent", "1.0.0");

export function startObservationHandle(
  provider: TracingProviderName,
  name: string,
  attributes: ObservationAttributes,
  asType: ObservationType,
  parent?: ObservationHandle,
): ObservationHandle {
  if (provider === "langfuse") {
    return createLangfuseHandle(name, attributes, asType, parent);
  }
  return createOtelHandle(name, attributes, asType, parent);
}

function createLangfuseHandle(
  name: string,
  attributes: ObservationAttributes,
  asType: ObservationType,
  parent?: ObservationHandle,
): ObservationHandle {
  const langfuseParent = parent as LangfuseObservationHandle | undefined;
  const observation = startObservation(name, attributes, {
    asType: asType as never,
    ...(langfuseParent ? { parentSpanContext: langfuseParent.spanContext() } : {}),
  }) as LangfuseObservation;
  return new LangfuseObservationHandle(observation);
}

class LangfuseObservationHandle implements ObservationHandle {
  private readonly otelSpan: Span;

  constructor(readonly raw: LangfuseObservation) {
    this.otelSpan = getOtelSpan(raw);
  }

  spanContext(): SpanContext {
    return this.otelSpan.spanContext();
  }

  update(attributes: ObservationAttributes & Record<string, unknown>): void {
    this.raw.update(attributes);
  }

  end(): void {
    this.raw.end();
  }

  startChild(name: string, attributes: ObservationAttributes, asType: ObservationType): ObservationHandle {
    return context.with(trace.setSpan(context.active(), this.otelSpan), () =>
      createLangfuseHandle(name, attributes, asType, this),
    );
  }
}

function getOtelSpan(raw: LangfuseObservation): Span {
  return (raw as LangfuseObservation & { otelSpan: Span }).otelSpan;
}

function createOtelHandle(
  name: string,
  attributes: ObservationAttributes,
  asType: ObservationType,
  parent?: ObservationHandle,
): ObservationHandle {
  const otelParent = parent as OtelObservationHandle | undefined;
  const parentContext = otelParent
    ? trace.setSpan(context.active(), otelParent.span)
    : context.active();
  const span = OTEL_TRACER.startSpan(
    name,
    {
      attributes: buildTraceRootAttributes(asType, attributes),
    },
    parentContext,
  );
  applyObservationLevel(span, attributes);
  return new OtelObservationHandle(span);
}

class OtelObservationHandle implements ObservationHandle {
  constructor(readonly span: Span) {}

  update(attributes: ObservationAttributes & Record<string, unknown>): void {
    this.span.setAttributes(buildTraceRootAttributes(undefined, attributes));
    applyObservationLevel(this.span, attributes);
  }

  end(): void {
    this.span.end();
  }

  startChild(name: string, attributes: ObservationAttributes, asType: ObservationType): ObservationHandle {
    return createOtelHandle(name, attributes, asType, this);
  }
}

function buildTraceRootAttributes(
  asType: ObservationType | undefined,
  attributes: ObservationAttributes & Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (asType) {
    result["traceroot.span.type"] = mapTraceRootSpanType(asType);
  }
  if (attributes.input !== undefined) {
    result["traceroot.span.input"] = serializeAttribute(attributes.input);
  }
  if (attributes.output !== undefined) {
    result["traceroot.span.output"] = serializeAttribute(attributes.output);
  }
  if (attributes.metadata) {
    for (const [key, value] of Object.entries(attributes.metadata)) {
      result[`traceroot.span.metadata.${key}`] = serializeAttribute(value);
    }
  }
  if (attributes.statusMessage) {
    result["traceroot.span.metadata.statusMessage"] = attributes.statusMessage;
  }
  return result;
}

function mapTraceRootSpanType(asType: ObservationType): string {
  switch (asType) {
    case "agent":
      return "AGENT";
    case "tool":
      return "TOOL";
    case "generation":
      return "LLM";
    default:
      return "SPAN";
  }
}

function applyObservationLevel(span: Span, attributes: ObservationAttributes): void {
  if (attributes.level === "ERROR") {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: attributes.statusMessage,
    });
    return;
  }
  if (attributes.level === "WARNING" && attributes.statusMessage) {
    span.setAttribute("traceroot.span.metadata.level", "WARNING");
  }
}

function serializeAttribute(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
