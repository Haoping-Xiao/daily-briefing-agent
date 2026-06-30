import { describe, expect, it } from "vitest";
import { resolveTracingProvider } from "../src/observability/create-tracer-from-env.js";

describe("resolveTracingProvider", () => {
  it("defaults to langfuse when unset", () => {
    expect(resolveTracingProvider({})).toBe("langfuse");
  });

  it("selects configured providers", () => {
    expect(resolveTracingProvider({ TRACING_PROVIDER: "traceroot" })).toBe("traceroot");
    expect(resolveTracingProvider({ TRACING_PROVIDER: "Langfuse" })).toBe("langfuse");
    expect(resolveTracingProvider({ TRACING_PROVIDER: "laminar" })).toBe("laminar");
    expect(resolveTracingProvider({ TRACING_PROVIDER: "lmnr" })).toBe("laminar");
    expect(resolveTracingProvider({ TRACING_PROVIDER: "braintrust" })).toBe("braintrust");
    expect(resolveTracingProvider({ TRACING_PROVIDER: "bt" })).toBe("braintrust");
  });

  it("treats disable aliases as noop", () => {
    for (const value of ["noop", "none", "off", "false", "disabled"]) {
      expect(resolveTracingProvider({ TRACING_PROVIDER: value })).toBe("noop");
    }
  });

  it("falls back to noop for unknown values", () => {
    expect(resolveTracingProvider({ TRACING_PROVIDER: "unknown" })).toBe("noop");
  });
});
