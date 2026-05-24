import type {
  BriefGenerationContext,
  RuleExpression,
  RulePolicy,
  SourcePolicy,
  SourceOperation,
  SourceType,
  UserPolicy,
  UserProfile,
  ValidationPolicy,
} from "../domain/types.js";

export function compileJordanPolicy(profile: UserProfile): UserPolicy {
  return {
    sourcePolicies: {
      calendar: sourcePolicy("calendar", [
        ...operationsFromRules(calendarRules()),
        calendarPrivateDetails(),
      ]),
      email: sourcePolicy("email", [
        ...operationsFromRules(emailRules()),
        emailPrivateDetails(),
        emailMedicalDetails(),
        emailRelevanceJudge(),
        emailPrivacyJudge(),
      ]),
      news: sourcePolicy("news", [
        ...operationsFromRules(newsRules()),
        newsSemanticExclusionJudge(),
        newsAiProductFitJudge(),
      ]),
    },
    briefGenerationContext: buildGenerationContext(profile),
    validationPolicy: buildValidationPolicy(profile),
  };
}

function sourcePolicy(sourceType: SourceType, operations: SourceOperation[]): SourcePolicy {
  return {
    sourceType,
    operations,
  };
}

function operationsFromRules(rulePolicy: RulePolicy): SourceOperation[] {
  return [...rulePolicy.filterRules, ...rulePolicy.scoringRules, ...rulePolicy.topicTagRules];
}

function calendarRules(): RulePolicy {
  return {
    filterRules: [],
    scoringRules: [
      score("boost_maya", contains("titleAndSummary", "Maya"), 40, "Maya Chen is a tracked family entity.", true),
      score("boost_board_prep", contains("titleAndSummary", "board"), 25, "Board prep is a priority work theme."),
      score("boost_psd3", contains("titleAndSummary", "PSD3"), 30, "PSD3 is a relevant fintech regulation theme."),
      score("boost_lyra", contains("titleAndSummary", "Lyra"), 20, "Lyra Finance is a tracked competitor."),
      score("boost_stripe", contains("titleAndSummary", "Stripe"), 20, "Stripe is a tracked partner."),
    ],
    topicTagRules: [
      tag("tag_schedule", { field: "sourceType", op: "equals", value: "calendar" }, "schedule", "Calendar items define the day plan."),
      tag("tag_maya", contains("titleAndSummary", "Maya"), "personal_family", "Maya Chen belongs to personal family context."),
      tag("tag_customer_research", contains("titleAndSummary", "Customer interview"), "customer_research", "Customer interview is a research theme."),
      tag("tag_board_prep", contains("titleAndSummary", "board"), "board_prep", "Board prep is a distinct work theme."),
      tag("tag_psd3", contains("titleAndSummary", "PSD3"), "psd3", "PSD3 is a cross-source theme."),
      tag("tag_lyra", contains("titleAndSummary", "Lyra"), "competitor_lyra", "Lyra Finance is a competitor theme."),
      tag("tag_stripe", contains("titleAndSummary", "Stripe"), "partner_stripe", "Stripe is a partner theme."),
    ],
  };
}

function emailRules(): RulePolicy {
  return {
    filterRules: [
      filter("drop_automated_promotions", { field: "labels", op: "intersects", values: ["automated", "promotions"] }, "drop", "Automated promotions are low briefing value."),
    ],
    scoringRules: [
      score("boost_action_required", { field: "labels", op: "intersects", values: ["action-required"] }, 35, "Action-required email needs attention.", true),
      score("boost_plaid", contains("titleAndSummary", "Plaid"), 30, "Plaid is a tracked integration vendor.", true),
      score("boost_psd3", contains("titleAndSummary", "PSD3"), 30, "PSD3 affects the user's fintech work.", true),
      score("boost_cobalt", contains("titleAndSummary", "Cobalt"), 25, "Cobalt Labs launch and product context should be considered, but source-level launch coverage can satisfy the must-include requirement."),
      score("boost_stripe", contains("titleAndSummary", "Stripe"), 20, "Stripe is a tracked partner."),
      score("boost_maya", contains("titleAndSummary", "Maya"), 40, "Maya Chen is a tracked family entity.", true),
    ],
    topicTagRules: [
      tag("tag_plaid", contains("titleAndSummary", "Plaid"), "vendor_plaid", "Plaid is a vendor theme."),
      tag("tag_psd3", contains("titleAndSummary", "PSD3"), "psd3", "PSD3 is a cross-source theme."),
      tag("tag_stripe", contains("titleAndSummary", "Stripe"), "partner_stripe", "Stripe is a partner theme."),
      tag("tag_cobalt", contains("titleAndSummary", "Cobalt"), "company_launch", "Cobalt Labs is the user's company."),
      tag("tag_maya", contains("titleAndSummary", "Maya"), "personal_family", "Maya Chen belongs to personal family context."),
      tag("tag_board", contains("titleAndSummary", "board"), "board_prep", "Board prep is a distinct work theme."),
    ],
  };
}

function newsRules(): RulePolicy {
  return {
    filterRules: [
      filter("drop_sports", { field: "titleAndSummary", op: "intersects", values: ["Lakers", "Manchester United", "FA Cup", "BBC Sport"] }, "drop", "User excludes sports scores and league standings."),
      filter("drop_entertainment", { field: "titleAndSummary", op: "intersects", values: ["Taylor Swift", "Marvel", "Avengers", "Cannes", "Variety"] }, "drop", "User excludes celebrity and entertainment news."),
      filter(
        "drop_daily_crypto_price_without_exception",
        { all: [contains("titleAndSummary", "Bitcoin"), { not: contains("titleAndSummary", "regulation") }, { not: contains("titleAndSummary", "charges") }, { not: contains("titleAndSummary", "enforcement") }] },
        "drop",
        "User excludes day-to-day crypto price movement unless regulation or enforcement is involved.",
      ),
    ],
    scoringRules: [
      score("boost_cobalt", contains("titleAndSummary", "Cobalt Labs"), 50, "Cobalt Labs is the user's company and launch news should always be surfaced.", true),
      score("boost_psd3", contains("titleAndSummary", "PSD3"), 30, "PSD3 is a relevant fintech regulation theme.", true),
      score("boost_stripe", contains("titleAndSummary", "Stripe"), 25, "Stripe is a tracked partner."),
      score("boost_plaid", contains("titleAndSummary", "Plaid"), 25, "Plaid is a tracked vendor."),
      score("boost_lyra", contains("titleAndSummary", "Lyra Finance"), 25, "Lyra Finance is the main tracked competitor."),
      score("boost_crypto_enforcement", contains("titleAndSummary", "SEC charges"), 20, "Crypto enforcement is allowed by the user's exception policy."),
      score("boost_ai_product", { field: "titleAndSummary", op: "intersects", values: ["OpenAI", "Anthropic", "Claude", "Copilot", "agent mode", "AI coding", "AI product", "LLM"] }, 15, "AI product applications are an interest area."),
    ],
    topicTagRules: [
      tag("tag_cobalt", contains("titleAndSummary", "Cobalt Labs"), "company_launch", "Cobalt Labs launch is a company theme."),
      tag("tag_psd3", contains("titleAndSummary", "PSD3"), "psd3", "PSD3 is a cross-source theme."),
      tag("tag_fintech_regulation", { field: "titleAndSummary", op: "intersects", values: ["SEC", "PSD3", "regulation", "fraud"] }, "fintech_regulation", "Fintech regulation is an interest area."),
      tag("tag_stripe", contains("titleAndSummary", "Stripe"), "partner_stripe", "Stripe is a partner theme."),
      tag("tag_plaid", contains("titleAndSummary", "Plaid"), "vendor_plaid", "Plaid is a vendor theme."),
      tag("tag_lyra", contains("titleAndSummary", "Lyra Finance"), "competitor_lyra", "Lyra is a competitor theme."),
      tag("tag_ai_product", { field: "titleAndSummary", op: "intersects", values: ["OpenAI", "Anthropic", "Claude", "Copilot", "agent mode", "AI coding", "AI product", "LLM"] }, "ai_product", "AI product applications are an interest area."),
    ],
  };
}

function buildGenerationContext(profile: UserProfile): BriefGenerationContext {
  return {
    toneRules: [profile.tone.style, ...profile.tone.rules, profile.deliveryNotes],
    interestRules: profile.interests,
    exclusionRules: profile.exclusions,
    trackedEntityRules: profile.trackedEntities.map((entity) => `${entity.name}: ${entity.reason}`),
    targetDurationSeconds: profile.audioLength.targetSeconds,
    minDurationSeconds: profile.audioLength.minSeconds,
    maxDurationSeconds: profile.audioLength.maxSeconds,
  };
}

function calendarPrivateDetails(): SourceOperation {
  return {
    type: "privacy",
    id: "privacy_private_calendar",
    when: { field: "visibility", op: "equals", value: "private" },
    redactedLabel: "private calendar details",
    reason: "Private calendar event details must not be spoken.",
    spokenReplacement: "You have a private appointment later today.",
  };
}

function emailPrivateDetails(): SourceOperation {
  return {
    type: "privacy",
    id: "privacy_private_email",
    when: { field: "labels", op: "intersects", values: ["private"] },
    redactedLabel: "private email details",
    reason: "Private labeled email details must not be spoken.",
    spokenReplacement: "There is a private email that needs discretion.",
  };
}

function emailMedicalDetails(): SourceOperation {
  return {
    type: "privacy",
    id: "privacy_medical_email",
    when: {
      any: [
        { field: "labels", op: "intersects", values: ["medical"] },
        { field: "titleAndSummary", op: "intersects", values: ["medical", "Sutter Health"] },
      ],
    },
    redactedLabel: "medical appointment details",
    reason: "Medical appointment details must not be spoken.",
    spokenReplacement: "There is a private personal appointment confirmation for later today.",
  };
}

function emailRelevanceJudge(): SourceOperation {
  return model(
    "model_email_relevance_and_exclusions",
    { field: "sourceType", op: "equals", value: "email" },
    "classify_relevance",
    "ModelRelevanceJudgment",
    [
      "Classify whether this email should remain eligible for Jordan's morning briefing.",
      "Apply the profile semantically, not by keyword: include action-required operational work, tracked entities, launch context, and family items.",
      "Recommend dropping or deprioritizing newsletters, mass threads, routine notifications, recruiter outreach, crypto price movement without regulation/enforcement, and anything low-value for a 75-second audio briefing.",
    ],
  );
}

function emailPrivacyJudge(): SourceOperation {
  return model(
    "model_email_privacy_review",
    { field: "sourceType", op: "equals", value: "email" },
    "detect_privacy_risk",
    "ModelPrivacyJudgment",
    [
      "Detect whether this email contains personal, medical, financial, account, family, or other sensitive details that should not be spoken verbatim.",
      "If sensitive, return a safe spoken replacement and restricted fact labels.",
      "Do not rely only on labels; infer risk from sender, title, and summary.",
    ],
  );
}

function newsSemanticExclusionJudge(): SourceOperation {
  return model(
    "model_news_semantic_exclusions",
    { field: "sourceType", op: "equals", value: "news" },
    "classify_relevance",
    "ModelRelevanceJudgment",
    [
      "Classify whether this news item violates Jordan's exclusions using semantics, not fixed keywords.",
      "Drop sports scores and league standings, celebrity and entertainment news, and day-to-day crypto price movement.",
      "Preserve crypto regulation or enforcement actions even if the item mentions crypto markets.",
      "Examples from the provided data: Manchester United FA Cup is sports, Marvel casting news is entertainment, Bitcoin crossing a price threshold is excluded, SEC crypto charges are allowed.",
    ],
  );
}

function newsAiProductFitJudge(): SourceOperation {
  return model(
    "model_news_ai_product_fit",
    { field: "titleAndSummary", op: "intersects", values: ["AI", "OpenAI", "Claude", "LLM", "agent", "benchmarks"] },
    "classify_relevance",
    "ModelRelevanceJudgment",
    [
      "Judge whether an AI item matches Jordan's interest in product applications of AI and large language models.",
      "Prefer deployed products, developer tools, agent workflows, platform implications, and business/product usage.",
      "Deprioritize pure research or benchmark-only stories unless they clearly affect product strategy.",
    ],
  );
}

function buildValidationPolicy(profile: UserProfile): ValidationPolicy {
  return {
    minDurationSeconds: profile.audioLength.minSeconds,
    maxDurationSeconds: profile.audioLength.maxSeconds,
    targetDurationSeconds: profile.audioLength.targetSeconds,
    wordsPerMinute: 130,
    forbiddenDetails: ["medical provider", "medical purpose", "private appointment details"],
  };
}

function contains(field: string, value: string): RuleExpression {
  return { field, op: "contains", value };
}

function filter(id: string, when: RuleExpression, action: "drop" | "deprioritize", reasonTemplate: string) {
  return { type: "filter" as const, id, when, action, reasonTemplate };
}

function score(id: string, when: RuleExpression, delta: number, reasonTemplate: string, mustInclude = false) {
  return { type: "score" as const, id, when, delta, reasonTemplate, mustInclude };
}

function tag(id: string, when: RuleExpression, topicTag: RulePolicy["topicTagRules"][number]["topicTag"], reasonTemplate: string) {
  return { type: "tag" as const, id, when, topicTag, reasonTemplate };
}

function model(
  id: string,
  when: RuleExpression,
  task: Extract<SourceOperation, { type: "model" }>["task"],
  outputSchema: Extract<SourceOperation, { type: "model" }>["outputSchema"],
  promptLines: string[],
) {
  return { type: "model" as const, id, when, task, outputSchema, prompt: promptLines.join(" ") };
}
