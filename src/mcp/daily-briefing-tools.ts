import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCandidateSearchTool } from "./tool-runtime.js";

const inputDir = process.env.DAILY_BRIEFING_INPUT_DIR ?? "inputs";

const server = new McpServer({
  name: "daily-briefing-sources",
  version: "1.0.0",
});

server.registerTool(
  "candidate_search",
  {
    title: "candidate_search",
    description: "Search processed, ranked, privacy-reviewed briefing candidates by keyword.",
    inputSchema: {
      briefingDate: z.string(),
      query: z.string().trim().min(1),
      topK: z.number().int().positive().max(50).optional(),
    },
  },
  async (input) => {
    const result = await runCandidateSearchTool(inputDir, input);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
