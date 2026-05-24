import { Agent, type AgentOptions, type SDKAgent } from "@cursor/sdk";
import type { AgentClient } from "./types.js";

export class CursorSdkAgentClient implements AgentClient {
  create(options: AgentOptions): Promise<SDKAgent> {
    return Agent.create(options);
  }
}
