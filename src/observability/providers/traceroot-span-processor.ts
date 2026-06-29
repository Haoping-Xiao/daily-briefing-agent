import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

export class TraceRootGitSpanProcessor implements SpanProcessor {
  constructor(
    private readonly inner: SpanProcessor,
    private readonly gitRepo?: string,
    private readonly gitRef?: string,
  ) {}

  onStart(span: Span, parentContext: Context): void {
    if (this.gitRepo) {
      span.setAttribute("traceroot.git.repo", this.gitRepo);
    }
    if (this.gitRef) {
      span.setAttribute("traceroot.git.ref", this.gitRef);
    }
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
