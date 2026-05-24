import { z } from "zod";
import type { CalendarBriefingItem, DataSource, RawCalendarInput } from "../domain/types.js";

const RawCalendarSchema: z.ZodType<RawCalendarInput> = z.object({
  date: z.string(),
  timezone: z.string(),
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string(),
      location: z.string(),
      attendees: z.array(z.string()),
      is_recurring: z.boolean(),
      visibility: z.literal("private").optional(),
      description: z.string(),
    }),
  ),
});

export class CalendarLoader {
  constructor(private readonly source: DataSource<RawCalendarInput>) {}

  async loadItems(): Promise<CalendarBriefingItem[]> {
    const raw = RawCalendarSchema.parse(await this.source.load());
    return raw.events.map((event) => ({
      id: event.id,
      sourceType: "calendar",
      title: event.title,
      summary: event.description,
      occurredAt: event.start,
      start: event.start,
      end: event.end,
      location: event.location,
      attendees: event.attendees,
      isRecurring: event.is_recurring,
      visibility: event.visibility,
      provenance: {
        sourceName: this.source.sourceName,
        originalId: event.id,
        origin: "file",
      },
    }));
  }
}
