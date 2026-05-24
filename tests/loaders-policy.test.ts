import { describe, expect, it } from "vitest";
import { JsonFileSource } from "../src/data/json-file-source.js";
import type { RawCalendarInput, RawEmailInput, RawNewsInput, RawProfileInput } from "../src/domain/types.js";
import { CalendarLoader } from "../src/loaders/calendar-loader.js";
import { EmailLoader } from "../src/loaders/email-loader.js";
import { NewsLoader } from "../src/loaders/news-loader.js";
import { ProfileLoader } from "../src/loaders/profile-loader.js";
import { compileJordanPolicy } from "../src/policy/jordan-policy-compiler.js";

describe("domain loaders", () => {
  it("loads the profile into an agent-friendly user profile", async () => {
    const profile = await new ProfileLoader(new JsonFileSource<RawProfileInput>("profile", "inputs/profile.json")).load();

    expect(profile.userId).toBe("jordan-chen");
    expect(profile.trackedEntities.map((entity) => entity.name)).toContain("Cobalt Labs");
    expect(profile.audioLength).toEqual({ minSeconds: 60, maxSeconds: 90, targetSeconds: 75 });
  });

  it("normalizes calendar items while preserving private visibility and provenance", async () => {
    const items = await new CalendarLoader(new JsonFileSource<RawCalendarInput>("calendar", "inputs/calendar.json")).loadItems();

    expect(items).toHaveLength(11);
    expect(items.find((item) => item.id === "cal_006")?.end).toBe("2026-05-15T13:30:00-07:00");
    expect(items.find((item) => item.id === "cal_011")?.visibility).toBe("private");
    expect(items[0].provenance).toEqual({ sourceName: "calendar", originalId: "cal_001", origin: "file" });
  });

  it("normalizes email items while preserving labels and sender identity", async () => {
    const items = await new EmailLoader(new JsonFileSource<RawEmailInput>("emails", "inputs/emails.json")).loadItems();

    expect(items).toHaveLength(20);
    expect(items.find((item) => item.id === "em_009")?.labels).toContain("action-required");
    expect(items.find((item) => item.id === "em_009")?.from.name).toBe("Plaid Partner Relations");
  });

  it("normalizes news items without using URLs as speakable content", async () => {
    const items = await new NewsLoader(new JsonFileSource<RawNewsInput>("news", "inputs/news.json")).loadItems();

    expect(items).toHaveLength(30);
    expect(items.find((item) => item.id === "news_001")?.url).toContain("techcrunch.com");
    expect(items.find((item) => item.id === "news_001")?.summary).not.toContain("https://");
  });
});

describe("compileJordanPolicy", () => {
  it("compiles tracked entities, exclusions, and duration into policies", async () => {
    const profile = await new ProfileLoader(new JsonFileSource<RawProfileInput>("profile", "inputs/profile.json")).load();
    const policy = compileJordanPolicy(profile);

    expect(policy.sourcePolicies.news.operations.filter((operation) => operation.type === "filter").map((operation) => operation.id)).toContain("drop_sports");
    expect(policy.sourcePolicies.news.operations.filter((operation) => operation.type === "filter").map((operation) => operation.id)).toContain(
      "drop_daily_crypto_price_without_exception",
    );
    expect(policy.sourcePolicies.email.operations.filter((operation) => operation.type === "score").map((operation) => operation.id)).toContain("boost_plaid");
    expect(policy.sourcePolicies.email.operations.filter((operation) => operation.type === "privacy").map((operation) => operation.id)).toContain("privacy_medical_email");
    expect(policy.sourcePolicies.email.operations.filter((operation) => operation.type === "model").map((operation) => operation.id)).toEqual(
      expect.arrayContaining(["model_email_relevance_and_exclusions", "model_email_privacy_review"]),
    );
    expect(policy.sourcePolicies.news.operations.filter((operation) => operation.type === "model").map((operation) => operation.id)).toEqual(
      expect.arrayContaining(["model_news_semantic_exclusions", "model_news_ai_product_fit"]),
    );
    expect(Object.values(policy.sourcePolicies).flatMap((sourcePolicy) => sourcePolicy.operations)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "model_calendar_briefing_value" })]),
    );
    expect(Object.values(policy.sourcePolicies).flatMap((sourcePolicy) => sourcePolicy.operations)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "model_news_briefing_value" })]),
    );
    expect(Object.values(policy.sourcePolicies).flatMap((sourcePolicy) => sourcePolicy.operations)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ task: "dedupe_or_cluster" })]),
    );
    expect(policy.briefGenerationContext.trackedEntityRules).toContain("Cobalt Labs: my company — always include");
    expect(policy.validationPolicy).toMatchObject({
      minDurationSeconds: 60,
      maxDurationSeconds: 90,
      targetDurationSeconds: 75,
      wordsPerMinute: 130,
    });
  });
});
