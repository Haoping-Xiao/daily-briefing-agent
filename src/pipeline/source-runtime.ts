import { join } from "node:path";
import { JsonFileSource } from "../data/json-file-source.js";
import type {
  RawCalendarInput,
  RawEmailInput,
  RawNewsInput,
  RawProfileInput,
  SourceProcessingResult,
  SourceType,
  UserPolicy,
} from "../domain/types.js";
import { CalendarLoader } from "../loaders/calendar-loader.js";
import { EmailLoader } from "../loaders/email-loader.js";
import { NewsLoader } from "../loaders/news-loader.js";
import { ProfileLoader } from "../loaders/profile-loader.js";
import { CalendarSourceProcessor } from "../processors/calendar-source-processor.js";
import { EmailSourceProcessor } from "../processors/email-source-processor.js";
import { NewsSourceProcessor } from "../processors/news-source-processor.js";
import { compileJordanPolicy } from "../policy/jordan-policy-compiler.js";
import type { ModelOperationEnhancer } from "../model/model-operation-enhancer.js";

export interface SourceRuntime {
  policy: UserPolicy;
  runTool(sourceType: SourceType): Promise<SourceProcessingResult>;
  runAllTools(): Promise<Record<SourceType, SourceProcessingResult>>;
}

export interface SourceRuntimeOptions {
  modelOperationEnhancer?: ModelOperationEnhancer;
}

export async function createSourceRuntime(inputDir: string, options: SourceRuntimeOptions = {}): Promise<SourceRuntime> {
  const profile = await new ProfileLoader(new JsonFileSource<RawProfileInput>("profile", join(inputDir, "profile.json"))).load();
  const policy = compileJordanPolicy(profile);
  const runTool = async (sourceType: SourceType): Promise<SourceProcessingResult> => {
    if (sourceType === "calendar") {
      const items = await new CalendarLoader(new JsonFileSource<RawCalendarInput>("calendar", join(inputDir, "calendar.json"))).loadItems();
      return enhance(await new CalendarSourceProcessor().process(items, policy.sourcePolicies.calendar), policy.sourcePolicies.calendar, options);
    }
    if (sourceType === "email") {
      const items = await new EmailLoader(new JsonFileSource<RawEmailInput>("emails", join(inputDir, "emails.json"))).loadItems();
      return enhance(await new EmailSourceProcessor().process(items, policy.sourcePolicies.email), policy.sourcePolicies.email, options);
    }
    const items = await new NewsLoader(new JsonFileSource<RawNewsInput>("news", join(inputDir, "news.json"))).loadItems();
    return enhance(await new NewsSourceProcessor().process(items, policy.sourcePolicies.news), policy.sourcePolicies.news, options);
  };

  return {
    policy,
    runTool,
    async runAllTools(): Promise<Record<SourceType, SourceProcessingResult>> {
      const [calendar, email, news] = await Promise.all([runTool("calendar"), runTool("email"), runTool("news")]);
      return { calendar, email, news };
    },
  };
}

async function enhance(
  result: SourceProcessingResult,
  policy: UserPolicy["sourcePolicies"][SourceType],
  options: SourceRuntimeOptions,
): Promise<SourceProcessingResult> {
  return options.modelOperationEnhancer ? options.modelOperationEnhancer.enhance(result, policy) : result;
}
