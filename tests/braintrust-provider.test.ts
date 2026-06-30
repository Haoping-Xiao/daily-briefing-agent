import { describe, expect, it } from "vitest";
import {
  createBraintrustBackend,
  resolveBraintrustParent,
} from "../src/observability/providers/braintrust.js";

describe("resolveBraintrustParent", () => {
  it("prefers BRAINTRUST_PARENT when set", () => {
    expect(
      resolveBraintrustParent({
        BRAINTRUST_PARENT: "project_name:my-project",
        BRAINTRUST_PROJECT_ID: "ignored",
      }),
    ).toBe("project_name:my-project");
  });

  it("builds parent from BRAINTRUST_PROJECT_ID", () => {
    expect(
      resolveBraintrustParent({
        BRAINTRUST_PROJECT_ID: "4f78dab5-e707-4037-bd9c-e3dbe9e17a86",
      }),
    ).toBe("project_id:4f78dab5-e707-4037-bd9c-e3dbe9e17a86");
  });

  it("returns null when parent is missing", () => {
    expect(resolveBraintrustParent({})).toBeNull();
  });
});

describe("createBraintrustBackend", () => {
  it("returns null without API key", () => {
    expect(
      createBraintrustBackend({
        BRAINTRUST_PROJECT_ID: "4f78dab5-e707-4037-bd9c-e3dbe9e17a86",
      }),
    ).toBeNull();
  });

  it("returns null without parent", () => {
    expect(
      createBraintrustBackend({
        BRAINTRUST_API_KEY: "test-key",
      }),
    ).toBeNull();
  });

  it("creates backend when credentials are present", () => {
    const backend = createBraintrustBackend({
      BRAINTRUST_API_KEY: "test-key",
      BRAINTRUST_PROJECT_ID: "4f78dab5-e707-4037-bd9c-e3dbe9e17a86",
    });

    expect(backend?.provider).toBe("braintrust");
    expect(backend?.getTracer()).toBeDefined();
  });
});
