import { startObservation } from "@langfuse/tracing";
import { context, SpanStatusCode, trace, type Span, type SpanContext, type Tracer } from "@opentelemetry/api";
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

export function startObservationHandle(
  provider: TracingProviderName,
  tracer: Tracer,
  name: string,
  attributes: ObservationAttributes,
  asType: ObservationType,
  parent?: ObservationHandle,
): ObservationHandle {
  if (provider === "langfuse") {
    return createLangfuseHandle(name, attributes, asType, parent);
  }
  return createOtelHandle(provider, tracer, name, attributes, asType, parent);
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
  provider: TracingProviderName,
  tracer: Tracer,
  name: string,
  attributes: ObservationAttributes,
  asType: ObservationType,
  parent?: ObservationHandle,
): ObservationHandle {
  const otelParent = parent as OtelObservationHandle | undefined;
  const parentContext = otelParent
    ? trace.setSpan(context.active(), otelParent.span)
    : context.active();
  const span = tracer.startSpan(
    name,
    {
      attributes: buildOtelSpanAttributes(provider, asType, attributes),
    },
    parentContext,
  );
  applyObservationLevel(provider, span, attributes);
  return new OtelObservationHandle(provider, tracer, span);
}

class OtelObservationHandle implements ObservationHandle {
  constructor(
    private readonly provider: TracingProviderName,
    private readonly tracer: Tracer,
    readonly span: Span,
  ) {}

  update(attributes: ObservationAttributes & Record<string, unknown>): void {
    this.span.setAttributes(buildOtelSpanAttributes(this.provider, undefined, attributes));
    applyObservationLevel(this.provider, this.span, attributes);
  }

  end(): void {
    this.span.end();
  }

  startChild(name: string, attributes: ObservationAttributes, asType: ObservationType): ObservationHandle {
    return createOtelHandle(this.provider, this.tracer, name, attributes, asType, this);
  }
}

function buildOtelSpanAttributes(
  provider: TracingProviderName,
  asType: ObservationType | undefined,
  attributes: ObservationAttributes & Record<string, unknown>,
): Record<string, string> {
  if (provider === "laminar") {
    return buildLaminarAttributes(asType, attributes);
  }
  return buildTraceRootAttributes(asType, attributes);
}

function buildLaminarAttributes(
  asType: ObservationType | undefined,
  attributes: ObservationAttributes & Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (asType) {
    result["lmnr.span.type"] = mapLaminarSpanType(asType);
  }
  if (attributes.input !== undefined) {
    result["lmnr.span.input"] = serializeAttribute(attributes.input);
  }
  if (attributes.output !== undefined) {
    result["lmnr.span.output"] = serializeAttribute(attributes.output);
  }
  if (attributes.metadata) {
    for (const [key, value] of Object.entries(attributes.metadata)) {
      if (asType) {
        result[`lmnr.association.properties.metadata.${key}`] = serializeAttribute(value);
      } else {
        result[`lmnr.span.metadata.${key}`] = serializeAttribute(value);
      }
    }
  }
  if (attributes.statusMessage) {
    if (asType) {
      result["lmnr.association.properties.metadata.statusMessage"] = attributes.statusMessage;
    } else {
      result["lmnr.span.metadata.statusMessage"] = attributes.statusMessage;
    }
  }
  return result;
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

function mapLaminarSpanType(asType: ObservationType): string {
  switch (asType) {
    case "tool":
      return "TOOL";
    case "generation":
      return "LLM";
    default:
      return "DEFAULT";
  }
}

function applyObservationLevel(
  provider: TracingProviderName,
  span: Span,
  attributes: ObservationAttributes,
): void {
  if (attributes.level === "ERROR") {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: attributes.statusMessage,
    });
    return;
  }
  if (attributes.level === "WARNING" && attributes.statusMessage) {
    const levelKey =
      provider === "laminar"
        ? "lmnr.association.properties.metadata.level"
        : "traceroot.span.metadata.level";
    span.setAttribute(levelKey, "WARNING");
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
