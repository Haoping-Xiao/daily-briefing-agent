import type { EmailBriefingItem, SourcePolicy, SourceProcessingResult } from "../domain/types.js";
import { processItems, type SourceProcessor } from "./source-processor.js";

export class EmailSourceProcessor implements SourceProcessor<EmailBriefingItem> {
  readonly sourceType = "email" as const;

  async process(items: EmailBriefingItem[], policy: SourcePolicy): Promise<SourceProcessingResult> {
    return processItems(items, policy);
  }
}
