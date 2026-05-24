export type SourceType = "calendar" | "email" | "news";

export interface DataSource<T> {
  readonly sourceName: string;
  load(): Promise<T>;
}

export interface RawProfileInput {
  user: {
    name: string;
    role: string;
    company: string;
    team: string;
    timezone: string;
    wake_time_local: string;
  };
  interests: string[];
  not_interested: string[];
  tracked_entities: Array<{ name: string; reason: string }>;
  tone: {
    style: string;
    rules: string[];
  };
  audio_length_seconds: {
    min: number;
    max: number;
    target: number;
  };
  delivery_notes: string;
}

export interface RawCalendarInput {
  date: string;
  timezone: string;
  events: RawCalendarEvent[];
}

export interface RawCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  is_recurring: boolean;
  visibility?: "private";
  description: string;
}

export interface RawEmailInput {
  window_start: string;
  window_end: string;
  emails: RawEmail[];
}

export interface RawEmail {
  id: string;
  from: {
    name: string;
    email: string;
  };
  to: string[];
  received_at: string;
  subject: string;
  summary: string;
  labels: string[];
}

export interface RawNewsInput {
  generated_at: string;
  items: RawNewsItem[];
}

export interface RawNewsItem {
  id: string;
  source: string;
  title: string;
  url: string;
  published_at: string;
  summary: string;
}

export interface UserProfile {
  userId: string;
  name: string;
  role: string;
  company: string;
  team: string;
  timezone: string;
  interests: string[];
  exclusions: string[];
  trackedEntities: TrackedEntity[];
  tone: TonePreference;
  audioLength: AudioLengthPreference;
  deliveryNotes: string;
}

export interface TrackedEntity {
  name: string;
  reason: string;
}

export interface TonePreference {
  style: string;
  rules: string[];
}

export interface AudioLengthPreference {
  minSeconds: number;
  maxSeconds: number;
  targetSeconds: number;
}

export interface UserPolicy {
  sourcePolicies: Record<SourceType, SourcePolicy>;
  briefGenerationContext: BriefGenerationContext;
  validationPolicy: ValidationPolicy;
}

export interface SourcePolicy {
  sourceType: SourceType;
  operations: SourceOperation[];
}

export interface RulePolicy {
  filterRules: FilterRule[];
  scoringRules: ScoringRule[];
  topicTagRules: TopicTagRule[];
}

export type SourceOperation = FilterOperation | ScoringOperation | TopicTagOperation | PrivacyOperation | ModelOperation;

export interface FilterOperation {
  type: "filter";
  id: string;
  when: RuleExpression;
  action: "drop" | "deprioritize";
  reasonTemplate: string;
}

export interface ScoringOperation {
  type: "score";
  id: string;
  when: RuleExpression;
  delta: number;
  reasonTemplate: string;
  mustInclude?: boolean;
}

export interface TopicTagOperation {
  type: "tag";
  id: string;
  when: RuleExpression;
  topicTag: TopicTag;
  reasonTemplate: string;
}

export interface PrivacyOperation {
  type: "privacy";
  id: string;
  when: RuleExpression;
  redactedLabel: string;
  reason: string;
  spokenReplacement: string;
}

export interface ModelOperation {
  type: "model";
  id: string;
  when: RuleExpression;
  task: ModelOperationTask;
  prompt: string;
  outputSchema: ModelOperationOutputSchemaName;
}

export type FilterRule = FilterOperation;
export type ScoringRule = ScoringOperation;
export type TopicTagRule = TopicTagOperation;

export type ModelOperationTask = "classify_relevance" | "score_briefing_value" | "detect_privacy_risk";

export type ModelOperationOutputSchemaName =
  | "ModelRelevanceJudgment"
  | "ModelBriefingValueJudgment"
  | "ModelPrivacyJudgment";

export type ModelOperationJudgment =
  | ModelRelevanceJudgment
  | ModelBriefingValueJudgment
  | ModelPrivacyJudgment;

export interface ModelJudgmentBase {
  operationId: string;
  candidateId: string;
  reason: string;
  confidence: number;
}

export interface ModelRelevanceJudgment extends ModelJudgmentBase {
  schema: "ModelRelevanceJudgment";
  action: "keep" | "drop" | "deprioritize";
  scoreDelta?: number;
  topicTags?: TopicTag[];
}

export interface ModelBriefingValueJudgment extends ModelJudgmentBase {
  schema: "ModelBriefingValueJudgment";
  scoreDelta: number;
  mustInclude?: boolean;
}

export interface ModelPrivacyJudgment extends ModelJudgmentBase {
  schema: "ModelPrivacyJudgment";
  hasPrivacyRisk: boolean;
  restrictedFacts?: RestrictedFact[];
  speakableFacts?: SpeakableFact[];
}

export type RuleExpression =
  | { all: RuleExpression[] }
  | { any: RuleExpression[] }
  | { not: RuleExpression }
  | RulePredicate;

export type RulePredicate =
  | { field: string; op: "contains"; value: string }
  | { field: string; op: "equals"; value: string | boolean }
  | { field: string; op: "in"; values: string[] }
  | { field: string; op: "intersects"; values: string[] };

export interface ValidationPolicy {
  minDurationSeconds: number;
  maxDurationSeconds: number;
  targetDurationSeconds: number;
  wordsPerMinute: number;
  forbiddenDetails: string[];
}

export interface BriefGenerationContext {
  toneRules: string[];
  interestRules: string[];
  exclusionRules: string[];
  trackedEntityRules: string[];
  targetDurationSeconds: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
}

export type BriefingItem = CalendarBriefingItem | EmailBriefingItem | NewsBriefingItem;

export interface BaseBriefingItem {
  id: string;
  sourceType: SourceType;
  title: string;
  summary: string;
  occurredAt?: string;
  provenance: {
    sourceName: string;
    originalId: string;
    origin: "file" | "api";
  };
}

export interface CalendarBriefingItem extends BaseBriefingItem {
  sourceType: "calendar";
  start: string;
  end: string;
  location: string;
  attendees: string[];
  isRecurring: boolean;
  visibility?: "private";
}

export interface EmailBriefingItem extends BaseBriefingItem {
  sourceType: "email";
  from: {
    name: string;
    email: string;
  };
  to: string[];
  receivedAt: string;
  labels: string[];
}

export interface NewsBriefingItem extends BaseBriefingItem {
  sourceType: "news";
  source: string;
  url: string;
  publishedAt: string;
}

export interface SourceCandidateToolRequest {
  briefingDate: string;
}

export interface SourceProcessingResult {
  candidates: RankedSourceCandidate[];
  discarded: DiscardedItem[];
}

export interface DiscardedItem {
  id: string;
  sourceType: SourceType;
  reason: string;
}

export interface RankedSourceCandidate {
  id: string;
  sourceType: SourceType;
  title: string;
  topicTags: TopicTag[];
  score: CandidateScore;
  mustInclude: boolean;
  filterReasons: string[];
  modelJudgments: ModelOperationJudgment[];
  speakableFacts: SpeakableFact[];
  restrictedFacts: RestrictedFact[];
  originalItemIds: string[];
}

export type TopicTag =
  | "schedule"
  | "schedule_conflict"
  | "board_prep"
  | "customer_research"
  | "partner_stripe"
  | "vendor_plaid"
  | "competitor_lyra"
  | "company_launch"
  | "fintech_regulation"
  | "psd3"
  | "ai_product"
  | "developer_tools"
  | "personal_family";

export interface CandidateScore {
  value: number;
  reasons: ScoreReason[];
}

export interface ScoreReason {
  source: "rule" | "model";
  label: string;
  reason: string;
  delta?: number;
  confidence?: number;
}

export interface SpeakableFact {
  raw: string;
  spoken: string;
}

export interface RestrictedFact {
  redactedLabel: string;
  reason: string;
}

export interface BriefingOutline {
  themes: BriefTheme[];
  sections: BriefingSectionOutline[];
  mustIncludeCandidateIds: string[];
  excludedCandidateIds: Array<{ id: string; reason: string }>;
  discardedInputItems: DiscardedItem[];
  explorationReasoning: string[];
}

export interface BriefTheme {
  id: string;
  topicTags: TopicTag[];
  candidateIds: string[];
  reason: string;
}

export interface BriefingSectionOutline {
  id: string;
  name: string;
  candidateIds: string[];
  coveredInputItemIds: {
    calendar: string[];
    emails: string[];
    news: string[];
  };
  targetWords: number;
}

export interface BriefingDraft {
  sections: BriefingDraftSection[];
  fullTextWithSectionMarkers: string;
  finalTtsText: string;
}

export interface BriefingDraftSection {
  sectionId: string;
  title: string;
  text: string;
  candidateIds: string[];
}

export interface ValidationIssue {
  validator: string;
  severity: "error" | "warning";
  message: string;
  candidateIds?: string[];
}

export interface BriefingMetadata {
  included: {
    calendar: string[];
    emails: string[];
    news: string[];
  };
  discarded: DiscardedItem[];
  sections: BriefingSectionMetadata[];
  wordCount: number;
  estimatedDurationSeconds: number;
  durationMethod: "Estimated from English word count at 130 words per minute.";
  mustIncludeCoverage: Array<{
    candidateId: string;
    covered: boolean;
    reason: string;
  }>;
}

export interface BriefingSectionMetadata {
  id: string;
  name: string;
  candidateIds: string[];
  startChar: number;
  endChar: number;
  startLine: number;
  endLine: number;
}
