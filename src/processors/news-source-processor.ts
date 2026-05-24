import type { NewsBriefingItem, SourcePolicy, SourceProcessingResult } from "../domain/types.js";
import { processItems, type SourceProcessor } from "./source-processor.js";

export class NewsSourceProcessor implements SourceProcessor<NewsBriefingItem> {
  readonly sourceType = "news" as const;

  async process(items: NewsBriefingItem[], policy: SourcePolicy): Promise<SourceProcessingResult> {
    return processItems(items, policy);
  }
}
