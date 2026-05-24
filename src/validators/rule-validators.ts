import type { DailyBriefingValidator } from "../agent/cursor-sdk-daily-briefing-runner.js";
import type { DailyBriefingRunResult } from "../agent/types.js";
import type { ValidationIssue } from "../domain/types.js";
import { estimateDurationSeconds, materializeFinalTtsText, wordCount } from "../output/metadata-builder.js";

export class RuleValidators implements DailyBriefingValidator {
  async validate(result: DailyBriefingRunResult): Promise<ValidationIssue[]> {
    const text = materializeFinalTtsText(result);
    return [
      ...englishOnly(text),
      ...noMarkdown(text),
      ...noUrlOrEmail(text),
      ...spokenNumbers(text),
      ...duration(text),
      ...privacyLeak(text),
      ...openingVariation(text),
    ];
  }
}

function issue(validator: string, message: string): ValidationIssue {
  return { validator, severity: "error", message };
}

function englishOnly(text: string): ValidationIssue[] {
  return /[\u4e00-\u9fff]/.test(text) ? [issue("EnglishOnlyValidationRule", "Briefing text must be English only.")] : [];
}

function noMarkdown(text: string): ValidationIssue[] {
  return /(^|\n)\s{0,3}(#{1,6}|\*|- )/.test(text)
    ? [issue("NoMarkdownValidationRule", "Final TTS text must not contain markdown markers.")]
    : [];
}

function noUrlOrEmail(text: string): ValidationIssue[] {
  return /(https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(text)
    ? [issue("NoUrlOrEmailValidationRule", "Final TTS text must not contain URLs or email addresses.")]
    : [];
}

function spokenNumbers(text: string): ValidationIssue[] {
  return /[$%]|\d/.test(text)
    ? [issue("SpokenNumberValidationRule", "Numbers and units must be written in spoken form.")]
    : [];
}

function duration(text: string): ValidationIssue[] {
  const estimated = estimateDurationSeconds(wordCount(text));
  return estimated < 60 || estimated > 90
    ? [issue("DurationValidationRule", `Estimated duration ${estimated} seconds is outside 60 to 90 seconds.`)]
    : [];
}

function privacyLeak(text: string): ValidationIssue[] {
  return /(sutter|medical|doctor|private appointment details|marked private)/i.test(text)
    ? [issue("PrivacyLeakValidationRule", "Final TTS text appears to reveal private or medical details.")]
    : [];
}

function openingVariation(text: string): ValidationIssue[] {
  return /^good morning\b/i.test(text.trim())
    ? [issue("OpeningVariationValidationRule", "Opening must not start with Good morning every day.")]
    : [];
}
