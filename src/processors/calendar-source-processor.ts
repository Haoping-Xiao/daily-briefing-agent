import type { CalendarBriefingItem, RankedSourceCandidate, SourcePolicy, SourceProcessingResult } from "../domain/types.js";
import { scoreReason, tags, processItems, type SourceProcessor } from "./source-processor.js";

export class CalendarSourceProcessor implements SourceProcessor<CalendarBriefingItem> {
  readonly sourceType = "calendar" as const;

  async process(items: CalendarBriefingItem[], policy: SourcePolicy): Promise<SourceProcessingResult> {
    return processItems(items, policy, detectConflicts(items));
  }
}

function detectConflicts(items: CalendarBriefingItem[]): RankedSourceCandidate[] {
  const conflicts: RankedSourceCandidate[] = [];
  for (let index = 0; index < items.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
      const left = items[index];
      const right = items[otherIndex];
      if (!overlaps(left, right)) continue;
      conflicts.push({
        id: `calendar_conflict_${left.id}_${right.id}`,
        sourceType: "calendar",
        title: `Schedule conflict: ${left.title} and ${right.title}`,
        topicTags: tags("schedule", "schedule_conflict", "personal_family", "customer_research"),
        score: {
          value: 100,
          reasons: [
            scoreReason(
              "calendar_overlap",
              `${left.title} overlaps with ${right.title}; this is a hard schedule risk.`,
              90,
            ),
          ],
        },
        mustInclude: true,
        filterReasons: [],
        modelJudgments: [],
        speakableFacts: [
          {
            raw: `${left.title} overlaps ${right.title}`,
            spoken: `Your one o'clock Maya call overlaps with the customer interview at one fifteen.`,
          },
        ],
        restrictedFacts: [],
        originalItemIds: [left.id, right.id],
      });
    }
  }
  return conflicts;
}

function overlaps(left: CalendarBriefingItem, right: CalendarBriefingItem): boolean {
  return Date.parse(left.start) < Date.parse(right.end) && Date.parse(right.start) < Date.parse(left.end);
}
