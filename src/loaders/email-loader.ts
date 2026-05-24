import { z } from "zod";
import type { DataSource, EmailBriefingItem, RawEmailInput } from "../domain/types.js";

const RawEmailSchema: z.ZodType<RawEmailInput> = z.object({
  window_start: z.string(),
  window_end: z.string(),
  emails: z.array(
    z.object({
      id: z.string(),
      from: z.object({ name: z.string(), email: z.string() }),
      to: z.array(z.string()),
      subject: z.string(),
      received_at: z.string(),
      summary: z.string(),
      labels: z.array(z.string()),
    }),
  ),
});

export class EmailLoader {
  constructor(private readonly source: DataSource<RawEmailInput>) {}

  async loadItems(): Promise<EmailBriefingItem[]> {
    const raw = RawEmailSchema.parse(await this.source.load());
    return raw.emails.map((email) => ({
      id: email.id,
      sourceType: "email",
      title: email.subject,
      summary: email.summary,
      occurredAt: email.received_at,
      from: email.from,
      to: email.to,
      receivedAt: email.received_at,
      labels: email.labels,
      provenance: {
        sourceName: this.source.sourceName,
        originalId: email.id,
        origin: "file",
      },
    }));
  }
}
