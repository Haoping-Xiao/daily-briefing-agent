import { writeFile } from "node:fs/promises";
import type { DailyBriefingRunResult } from "../agent/types.js";
import { buildBriefingMetadata, materializeFinalTtsText } from "./metadata-builder.js";

export interface OutputPaths {
  textPath: string;
  jsonPath: string;
}

export async function writeBriefingOutputs(result: DailyBriefingRunResult, paths: OutputPaths): Promise<void> {
  const metadata = buildBriefingMetadata(result);
  await writeFile(paths.textPath, `${materializeFinalTtsText(result)}\n`, "utf8");
  await writeFile(paths.jsonPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
