# Daily Briefing Agent Architecture Draft

> Temporary draft for review. This captures the current architecture discussion before merging it back into the formal plan.

allowed

This project should not be a single LLM prompt that summarizes four JSON files. It should be a small, repeatable Agent system where each information source is exposed to the Agent as a tool. The Agent calls those tools to receive explainable, scored `RankedSourceCandidate[]` outputs, then uses its runtime-loaded know-how to explore cross-source themes and generate the final English TTS briefing from an approved plan.

The most important design principle is:

- `DataSource` only loads data.
- Source candidate tools are the Agent-facing interface for calendar, email, and news.
- Each source candidate tool applies source-specific rules, user policy, tags, scoring, and optional model judgment before returning `RankedSourceCandidate[]`.
- Brief exploration and generation happen inside the Cursor SDK Agent runtime; skills are runtime-loaded know-how documents the Agent may consult, not application classes or domain services.
- Validators prove that core constraints were met.

## Key Correction: User Policy Enters Source Processing, Not Raw Data Loading

The user's profile should influence filtering, scoring, tags, and generation style. It should not be embedded in the raw `DataSource` layer, because `DataSource` should remain a reusable I/O abstraction.

Recommended model:

```typescript
class UserProfile {
  constructor(
    readonly userId: string,
    readonly interests: InterestPreference[],
    readonly exclusions: ExclusionPreference[],
    readonly trackedEntities: TrackedEntity[],
    readonly tone: TonePreference,
    readonly audioLength: AudioLengthPreference
  ) {}
}

class UserPolicyCompiler {
  compile(profile: UserProfile): UserPolicy;
}

class UserPolicy {
  constructor(
    readonly sourcePolicies: SourcePolicy[],
    readonly briefGenerationContext: BriefGenerationContext,
    readonly validationPolicy: ValidationPolicy
  ) {}
}
```

So the system does not hard-code "Jordan likes fintech" inside every component. Instead:

- The profile says Jordan tracks Cobalt, Stripe, Plaid, Lyra, and Maya.
- `UserPolicyCompiler` turns those preferences into source policies and a generation context.
- Each source candidate tool receives only the slice of policy relevant to that source.
- The Agent receives a compact, Agent-friendly `BriefGenerationContext`.

## Layered Architecture

```mermaid
flowchart TD
  ProfileSource["Profile DataSource"] --> ProfileLoader["ProfileLoader"]
  CalendarSource["Calendar DataSource"] --> CalendarLoader["CalendarLoader"]
  EmailSource["Email DataSource"] --> EmailLoader["EmailLoader"]
  NewsSource["News DataSource"] --> NewsLoader["NewsLoader"]

  ProfileLoader --> PolicyCompiler["UserPolicyCompiler"]
  PolicyCompiler --> UserPolicy["UserPolicy"]
  UserPolicy --> GenerationContext["BriefGenerationContext"]

  CalendarLoader --> CalendarTool["calendar_candidates tool"]
  EmailLoader --> EmailTool["email_candidates tool"]
  NewsLoader --> NewsTool["news_candidates tool"]

  UserPolicy --> CalendarTool
  UserPolicy --> EmailTool
  UserPolicy --> NewsTool

  CursorSdk["Cursor SDK TypeScript\nAgent.create({ local, mcpServers })"] --> Agent["Daily Briefing Agent Runtime"]
  Agent -. "calls tool" .-> CalendarTool
  Agent -. "calls tool" .-> EmailTool
  Agent -. "calls tool" .-> NewsTool
  CalendarTool -. "returns RankedSourceCandidate[]" .-> Agent
  EmailTool -. "returns RankedSourceCandidate[]" .-> Agent
  NewsTool -. "returns RankedSourceCandidate[]" .-> Agent
  GenerationContext --> Agent

  Agent --> Outline["BriefingOutline"]
  Agent --> BriefDraft["BriefingDraft"]

  BriefDraft --> RuleValidators["RuleValidators"]
  BriefDraft --> LlmJudges["LLMJudgeValidators"]
  RuleValidators -->|pass| ValidationGate["ValidationGate"]
  LlmJudges -->|pass| ValidationGate
  ValidationGate --> OutputWriter["OutputWriter"]
  RuleValidators -->|fail with issues| Agent
  LlmJudges -->|fail with issues| Agent
```



## What Each Block Does

### DataSource

`DataSource<T>` abstracts where raw data comes from.

```typescript
interface DataSource<T> {
  readonly sourceName: string;
  load(): Promise<T>;
}
```

Current implementation:

- `JsonFileSource<RawProfileInput>`
- `JsonFileSource<RawCalendarInput>`
- `JsonFileSource<RawEmailInput>`
- `JsonFileSource<RawNewsInput>`

Future implementations:

- `GoogleCalendarSource`
- `GmailSource`
- `RssFeedSource`
- `SlackSource`
- `TaskSource`

The rest of the system should not know whether data came from a local file or an API.

### Domain Loaders

Each input domain has its own loader:

```typescript
class ProfileLoader {
  constructor(private source: DataSource<RawProfileInput>) {}
  async load(): Promise<UserProfile>;
}

interface BriefingItemProvider {
  loadItems(): Promise<BriefingItem[]>;
}

class CalendarLoader implements BriefingItemProvider {
  constructor(private source: DataSource<RawCalendarInput>) {}
  async loadItems(): Promise<CalendarBriefingItem[]>;
}

class EmailLoader implements BriefingItemProvider {
  constructor(private source: DataSource<RawEmailInput>) {}
  async loadItems(): Promise<EmailBriefingItem[]>;
}

class NewsLoader implements BriefingItemProvider {
  constructor(private source: DataSource<RawNewsInput>) {}
  async loadItems(): Promise<NewsBriefingItem[]>;
}
```

Responsibilities:

- Validate raw input shape.
- Normalize time fields.
- Preserve original ids.
- Attach provenance.
- Convert source-specific data directly into `BriefingItem` variants.

### Source Candidate Tools

After each loader returns normalized source items, the application exposes each information source to the Agent as a tool:

- `calendar_candidates`
- `email_candidates`
- `news_candidates`

These are the Agent-facing boundaries. When the Agent needs source context, it calls the relevant tools and receives `RankedSourceCandidate[]`. The tool implementation can use loaders, deterministic rules, model-assisted judges, and user policy internally, but the Agent does not talk to `DataSource`, loaders, processors, or source-specific policy objects directly.

The Agent should pass only request-level context such as the briefing date. The application wires each tool to the relevant `SourcePolicy` before exposing it through the Cursor SDK runtime.

Cursor SDK does not model these as in-process callback functions passed directly to the Agent. Custom Agent-callable tools should be exposed through MCP. For this project, that can be a lightweight local `stdio` MCP server owned by the repo; it does not need to be a deployed remote service. The server exposes the three source tools, and each tool returns `RankedSourceCandidate[]`.

```typescript
interface SourceCandidateTool {
  readonly name: "calendar_candidates" | "email_candidates" | "news_candidates";

  run(input: SourceCandidateToolRequest): Promise<RankedSourceCandidate[]>;
}

interface SourceCandidateToolRequest {
  briefingDate: string;
}

interface SourceProcessor<TItem extends BriefingItem> {
  readonly sourceType: "calendar" | "email" | "news";

  process(
    items: TItem[],
    policy: SourcePolicy,
    context: BriefingContext
  ): Promise<SourceProcessingResult>;
}

class CalendarSourceProcessor implements SourceProcessor<CalendarBriefingItem> {}
class EmailSourceProcessor implements SourceProcessor<EmailBriefingItem> {}
class NewsSourceProcessor implements SourceProcessor<NewsBriefingItem> {}
```

Each source candidate tool can combine two styles of judgment:

- Pure rules for deterministic facts and hard constraints.
- Model-assisted judges for semantic relevance that is hard to capture with simple rules.

For example:

- Calendar conflict detection is pure rule; if detected, it should produce a `mustInclude` candidate with a very high score and explicit reasoning.
- `action-required` email labels are pure rule; ambiguous "does Jordan need to act today?" checks can use a model.
- Sports, entertainment, and daily crypto price news are pure rule drops; nuanced "is this fintech or AI news relevant to Jordan's work today?" can use a model.

Any model-assisted judgment must return structured reasoning. The system should not accept a model decision without a reason that can be copied into `scoreReasons`. Items that are hard-dropped can be omitted from the tool result, but that decision should still be observable in internal logs or metadata outside the Agent-facing tool contract.

```typescript
interface SourceProcessingResult {
  candidates: RankedSourceCandidate[];
  discarded: DiscardedItem[];
}

interface ModelJudgment {
  decision: "keep" | "drop" | "deprioritize";
  confidence: number;
  reason: string;
}

interface DiscardedItem {
  id: string;
  sourceType: "calendar" | "email" | "news";
  reason: string;
}
```

### UserPolicyCompiler

Compiles user profile data into source policies, a generation context, and validation policy.

For Jordan's profile, it creates rules such as:

- Include or heavily boost Cobalt Labs.
- Include Maya Chen mentions, while still respecting privacy and brevity.
- Boost Stripe, Plaid, and Lyra Finance.
- Penalize celebrity, entertainment, sports, and crypto price movement.
- Allow crypto regulation and enforcement exceptions.
- Enforce warm but efficient tone.
- Enforce 60 to 90 seconds, target 75 seconds.

This keeps user modeling separate from raw data access while still allowing each information source to apply user-specific rules. It is separated from `UserPolicy` because compilation is a process, while `UserPolicy` is the result used by the pipeline. In a minimal implementation, this can be a pure `compileUserPolicy(profile)` function, but the architecture names it as a compiler to make the responsibility explicit.

### Shared Briefing Item Model

There is no separate `ItemNormalizer` class. Each domain loader owns normalization for its own source because it understands that source's shape and edge cases. The common contract is that every content loader returns `BriefingItem` variants.

```typescript
type BriefingItem =
  | CalendarBriefingItem
  | EmailBriefingItem
  | NewsBriefingItem;

interface BaseBriefingItem {
  id: string;
  sourceType: "calendar" | "email" | "news";
  title: string;
  summary: string;
  occurredAt?: string;
  provenance: {
    sourceName: string;
    originalId: string;
    origin: "file" | "api";
  };
}
```

Downstream modules depend on `BriefingItem`, not on raw JSON file structure.

### Ranked Source Candidate

Every source candidate tool outputs candidates with tags, scores, and reasoning. This is the main observability unit for the system.

```typescript
interface RankedSourceCandidate {
  id: string;
  sourceType: "calendar" | "email" | "news";
  title: string;
  tags: CandidateTag[];
  score: number;
  mustInclude: boolean;
  scoreReasons: string[];
  allowedFacts: BriefingFact[];
  restrictedFacts: RestrictedFact[];
  originalItemIds: string[];
}

interface BriefingFact {
  raw: string;
  spoken: string;
}

interface RestrictedFact {
  redactedLabel: string;
  reason: string;
}
```

Examples:

- Calendar conflict candidate:
  - tags: `CALENDAR_CONFLICT`, `SCHEDULE_RISK`
  - score: high
  - mustInclude: true
  - scoreReasons: conflict between Maya call and customer interview
- Plaid action candidate:
  - tags: `ACTION_REQUIRED`, `TRACKED_ENTITY`
  - score: high
  - mustInclude: true
  - scoreReasons: action-required label, Plaid tracked entity, Jordan listed owner
- Bitcoin price candidate:
  - tags: `NOT_INTERESTED`, `CRYPTO_PRICE`
  - score: low or dropped
  - scoreReasons: user excludes daily crypto price movement

`allowedFacts` should include TTS-friendly spoken forms before generation. For example, instead of only passing `Cobalt processed $4B in beta volume`, pass a fact whose `spoken` value is `Cobalt processed four billion dollars in beta volume`. This reduces the chance that the Agent emits symbols such as `$4B` or `23%`.

`restrictedFacts` are internal safety traces. They should not be passed into the Agent's generation prompt. The Agent only receives `allowedFacts`; validators can check redacted labels or policy constraints such as "do not reveal medical provider or medical purpose."

### Agent Exploration

Brief exploration is not an application class. It is a responsibility performed by the Daily Briefing Agent after it calls the three source candidate tools. Following the [Agent Skills model](https://agentskills.io/home), any skill involved here is a directory containing `SKILL.md` plus optional reference files, scripts, or assets. The Agent runtime may load that know-how when relevant, but the architecture boundary is the Agent and its tools, not a separate skill object.

The application-level contract is therefore the structured outline the Agent must produce after tool use:

```typescript
interface BriefingOutline {
  themes: BriefTheme[];
  sections: BriefingSectionOutline[];
  mustIncludeCandidateIds: string[];
  excludedCandidateIds: Array<{ id: string; reason: string }>;
  explorationReasoning: string[];
}

interface BriefingSectionOutline {
  id: string;
  name: string;
  candidateIds: string[];
  targetWords: number;
}
```

Responsibilities:

- Call the calendar, email, and news candidate tools as needed.
- Explore each tool's ranked output.
- Identify today's theme categories, such as schedule risks, urgent actions, launch context, regulation, or competitor watch.
- Merge duplicate or complementary facts across sources.
- Preserve every `mustInclude` candidate unless there is a documented impossibility.
- Produce section outlines with target word budgets and candidate ids.
- Output a compact `BriefingOutline` for generation.

Important cross-source themes in this dataset:

- PSD3: calendar compliance sync, action-required email, Reuters news.
- Stripe: lunch event, partner email, Issuing expansion news.
- Lyra: SDK teardown, funding news, new president.
- Board prep: board prep calendar event and CEO email.
- Cobalt launch: tracked company and GA news.

### Agent Generation

`BriefGenerationContext` is derived from user profile and should be Agent-friendly:

```typescript
interface BriefGenerationContext {
  toneRules: string[];
  interestRules: string[];
  exclusionRules: string[];
  trackedEntityRules: string[];
  targetDurationSeconds: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
}
```

Purpose:

- Translate the user's profile into instructions the Agent can reliably follow.
- Apply tone and length preferences.
- Generate a sectioned spoken brief from approved facts.
- Avoid using raw inputs directly.
- Preserve must-include items and explain if any cannot fit.
- Follow the section order from `BriefingOutline`; the program computes final section ranges after the text is generated.

The generation know-how can live in an Agent Skill folder, but that folder is not shown as a separate component in the architecture. It is part of how the Agent performs the task at runtime, similar to instructions or reference material.

### Agent Skills Discovery

Skills are not passed to Cursor SDK as a `skills` parameter. They are discovered from the workspace file system. For this project, keep project-level skills in one of:

- `.cursor/skills/<skill-name>/SKILL.md`
- `.agents/skills/<skill-name>/SKILL.md`

Each skill folder may include `SKILL.md` plus optional `references/`, `scripts/`, or `assets/`. The Agent runtime loads the skill metadata, then loads the full instructions when the skill is relevant. For local SDK runs, `local.cwd` must point at the project root. Using `local.settingSources: ["project"]` makes the dependency on project-level Cursor configuration explicit. For cloud runs, the skill folders must be committed to the repo so the cloud Agent can discover them.

### CursorSdkDailyBriefingRunner

Uses the [Cursor SDK TypeScript runtime](https://cursor.com/docs/sdk/typescript) to create a local Agent and provide the three source candidate tools through MCP server configuration. The runner owns Agent lifecycle and validation/revision loops; it does not implement briefing intelligence itself.

```typescript
interface DailyBriefingAgentRunner {
  run(input: DailyBriefingRunInput): Promise<BriefingDraft>;
  revise(input: DailyBriefingRevisionInput): Promise<BriefingDraft>;
}

interface DailyBriefingRunInput {
  context: BriefGenerationContext;
  toolNames: ["calendar_candidates", "email_candidates", "news_candidates"];
}

class CursorSdkDailyBriefingRunner implements DailyBriefingAgentRunner {
  constructor(private options: CursorSdkRuntimeOptions) {}
}
```

Recommended local SDK wiring:

```typescript
import { Agent } from "@cursor/sdk";

await using agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY!,
  model: { id: "composer-2.5" },
  local: {
    cwd: process.cwd(),
    settingSources: ["project"],
  },
  mcpServers: {
    "daily-briefing-sources": {
      type: "stdio",
      command: "node",
      args: ["dist/mcp/daily-briefing-tools.js"],
      cwd: process.cwd(),
    },
  },
});
```

Inline `mcpServers` are explicit and good for this runner because the three tools are part of the application contract. They are not persisted across `Agent.resume()`, so resume flows must pass them again. A file-based `.cursor/mcp.json` is also valid, but then the local SDK run must include project settings in `local.settingSources`.

Important boundary:

- It should not receive all raw inputs.
- It should not bypass the source candidate tools.
- It should not invent facts.
- It should not override privacy rules.

### Validators

Validation has two layers.

```typescript
interface RuleValidator {
  readonly name: string;
  validate(draft: BriefingDraft, outline: BriefingOutline): ValidationIssue[];
}

interface LlmJudgeValidator {
  readonly name: string;
  judge(
    draft: BriefingDraft,
    outline: BriefingOutline,
    candidates: RankedSourceCandidate[]
  ): Promise<ValidationIssue[]>;
}
```

Rule validators check objective constraints:

- `EnglishOnlyValidationRule`
- `NoMarkdownValidationRule`
- `NoUrlOrEmailValidationRule`
- `SpokenNumberValidationRule`
- `DurationValidationRule`
- `PrivacyLeakValidationRule`
- `OpeningVariationValidationRule`

Duration should be estimated with a standard words-per-minute assumption rather than an arbitrary constant. For English spoken audio, use roughly 155 words per minute:

```text
estimatedDurationSeconds = wordCount / 155 * 60
```

The output metadata should store both the estimate and the method.

LLM judge validators check semantic constraints:

- `MustIncludeCoverageJudge`: high-score or `mustInclude` candidates are reflected in the brief.
- `NoUnsupportedFactJudge`: the brief does not introduce facts outside approved candidates.
- `UserPreferenceFitJudge`: the brief respects the user's tone and topic preferences.

If validation fails, the draft is sent back to the Agent with concrete issues. Final files are written only after both rule validation and LLM judge validation pass.

### OutputWriter

Writes:

- `briefing.txt`
- `briefing.json`

Metadata should be generated from internal structures, not guessed by the LLM.

Program-computed metadata should include:

```typescript
interface BriefingMetadata {
  included: {
    calendar: string[];
    emails: string[];
    news: string[];
  };
  discarded: DiscardedItem[];
  sections: BriefingSectionMetadata[];
  wordCount: number;
  estimatedDurationSeconds: number;
  durationMethod: "Estimated from English word count at 155 words per minute.";
  mustIncludeCoverage: Array<{
    candidateId: string;
    covered: boolean;
    reason: string;
  }>;
}

interface BriefingSectionMetadata {
  id: string;
  name: string;
  candidateIds: string[];
  startLine: number;
  endLine: number;
}
```

Section ids, names, candidate ids, and target word budgets come from `BriefingOutline`. Final `startLine` and `endLine` are computed by the program from the final `briefing.txt`; the model should not guess ranges.

## How This Design Handles The Known Dataset Traps

- `cal_006` and `cal_007` conflict: `CalendarSourceProcessor` detects overlap by rule, sets `mustInclude`, and gives it a very high score with reasoning.
- `cal_011` is private: `CalendarSourceProcessor` tags it as restricted; the Agent may only use generic wording.
- `em_020` is medical: `EmailSourceProcessor` tags it as sensitive and restricted; rule validators prevent medical detail leakage.
- `em_009` is Plaid action-required: `EmailSourceProcessor` boosts it by rule because it has `action-required`, mentions Plaid, and lists Jordan as owner.
- `em_011` is PSD3 action-required: `EmailSourceProcessor` boosts it; the Agent links it with `cal_009` and `news_002`.
- `em_001` links to board prep: the Agent links it with `cal_008`.
- `em_002` links to Priya one-on-one: the Agent links it with `cal_003`.
- `em_003` says tomorrow but was received the previous evening: source processing and exploration should use timestamps and event matching, not only the word "tomorrow".
- PSD3, Stripe, Lyra, and Cobalt are discovered as cross-source themes by the Agent.
- Cobalt Labs always include: generated from user policy and applied as source-level scoring plus generation context.
- Maya Chen anything mentioning her goes in: generated from user policy, but privacy rules still apply.
- Bitcoin price items are dropped or strongly deprioritized by source-level rules from user exclusion policy.
- Crypto enforcement remains eligible through the user's exception policy.
- Sports and entertainment are dropped with reasons by `NewsSourceProcessor`.
- Automated and low-value notifications are dropped or deprioritized with reasons by `EmailSourceProcessor`.
- TTS-risky numeric forms are tagged by source processors and validated by rule validators.
- Must-include coverage is checked by an LLM judge, because pure string checks are not reliable enough to verify semantic coverage.
- Section ranges are derived from the final text and `BriefingOutline`, not from model guesses.
- Duration metadata uses word count and a 155 words-per-minute estimate.

## Extensibility Principle

The system should be open for new data sources and user rules without rewriting the main pipeline.

Future additions should usually happen by adding one of:

- A new `DataSource`
- A new domain loader
- A new `SourceProcessor`
- A new source-level rule
- A new source-level model judge
- A new candidate tag
- A new Agent Skill know-how folder
- A new rule validator
- A new LLM judge validator
- A new metadata field derived from existing internal structures

The pipeline itself should stay stable.