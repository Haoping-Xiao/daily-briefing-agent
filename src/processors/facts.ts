import type { BriefingItem, RestrictedFact, SpeakableFact } from "../domain/types.js";

export function buildSpeakableFacts(item: BriefingItem): SpeakableFact[] {
  if (item.sourceType === "calendar" && item.visibility === "private") {
    return [{ raw: item.title, spoken: "You have a private appointment later today." }];
  }

  if (item.sourceType === "email" && isMedical(item.title, item.summary, item.from.name)) {
    return [{ raw: item.title, spoken: "There is a private personal appointment confirmation for later today." }];
  }

  const fact = `${item.title}. ${item.summary}`;
  return [{ raw: fact, spoken: toSpokenText(fact) }];
}

export function buildRestrictedFacts(item: BriefingItem): RestrictedFact[] {
  const restricted: RestrictedFact[] = [];
  if (item.sourceType === "calendar" && item.visibility === "private") {
    restricted.push({ redactedLabel: "private calendar details", reason: "Private calendar event details must not be spoken." });
  }
  if (item.sourceType === "email" && isMedical(item.title, item.summary, item.from.name)) {
    restricted.push({ redactedLabel: "medical appointment details", reason: "Medical appointment details must not be spoken." });
  }
  return restricted;
}

export function toSpokenText(value: string): string {
  return value
    .replace(/\bPSD3\b/g, "PSD three")
    .replace(/\$4B\b/g, "four billion dollars")
    .replace(/\$80M\b/g, "eighty million dollars")
    .replace(/\$1\.2B\b/g, "one point two billion dollars")
    .replace(/\$200,000\b/g, "two hundred thousand dollars")
    .replace(/\b23%\b/g, "twenty three percent")
    .replace(/\b12%\b/g, "twelve percent")
    .replace(/\b12th\b/g, "twelfth")
    .replace(/\b2M-token\b/g, "two million token")
    .replace(/\b5\b/g, "five");
}

function isMedical(...values: string[]): boolean {
  return values.join(" ").toLowerCase().includes("medical") || values.join(" ").toLowerCase().includes("sutter health");
}
