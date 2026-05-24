import { z } from "zod";
import type { DataSource, RawProfileInput, UserProfile } from "../domain/types.js";

const RawProfileSchema: z.ZodType<RawProfileInput> = z.object({
  user: z.object({
    name: z.string(),
    role: z.string(),
    company: z.string(),
    team: z.string(),
    timezone: z.string(),
    wake_time_local: z.string(),
  }),
  interests: z.array(z.string()),
  not_interested: z.array(z.string()),
  tracked_entities: z.array(z.object({ name: z.string(), reason: z.string() })),
  tone: z.object({
    style: z.string(),
    rules: z.array(z.string()),
  }),
  audio_length_seconds: z.object({
    min: z.number(),
    max: z.number(),
    target: z.number(),
  }),
  delivery_notes: z.string(),
});

export class ProfileLoader {
  constructor(private readonly source: DataSource<RawProfileInput>) {}

  async load(): Promise<UserProfile> {
    const raw = RawProfileSchema.parse(await this.source.load());
    return {
      userId: slugify(raw.user.name),
      name: raw.user.name,
      role: raw.user.role,
      company: raw.user.company,
      team: raw.user.team,
      timezone: raw.user.timezone,
      interests: raw.interests,
      exclusions: raw.not_interested,
      trackedEntities: raw.tracked_entities,
      tone: raw.tone,
      audioLength: {
        minSeconds: raw.audio_length_seconds.min,
        maxSeconds: raw.audio_length_seconds.max,
        targetSeconds: raw.audio_length_seconds.target,
      },
      deliveryNotes: raw.delivery_notes,
    };
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
