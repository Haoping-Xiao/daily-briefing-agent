import { describe, expect, it } from "vitest";
import { runCandidateSearchTool } from "../src/mcp/tool-runtime.js";

describe("MCP tool runtime", () => {
  it("searches processed candidates by keyword", async () => {
    const result = await runCandidateSearchTool("inputs", { briefingDate: "2026-05-15", query: "Cobalt", topK: 3 });

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        id: "news_001",
        sourceType: "news",
        score: expect.any(Object),
      }),
    );
    expect(result.results.length).toBeLessThanOrEqual(3);
  });

  it("rejects malformed tool input", async () => {
    await expect(runCandidateSearchTool("inputs", { briefingDate: "2026-05-15", query: "" })).rejects.toThrow();
  });

  it("uses restricted facts for matching without exposing them", async () => {
    const result = await runCandidateSearchTool("inputs", { briefingDate: "2026-05-15", query: "medical", topK: 5 });

    expect(result.results.some((candidate) => candidate.matchedRestrictedFacts)).toBe(true);
    expect(JSON.stringify(result.results)).not.toContain("restrictedFacts");
  });

  it("returns top ranked candidates for wildcard search", async () => {
    const result = await runCandidateSearchTool("inputs", { briefingDate: "2026-05-15", query: "*", topK: 5 });

    expect(result.results).toHaveLength(5);
    expect(result.results[0].mustInclude).toBe(true);
  });
});
