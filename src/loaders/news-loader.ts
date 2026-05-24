import { z } from "zod";
import type { DataSource, NewsBriefingItem, RawNewsInput } from "../domain/types.js";

const RawNewsSchema: z.ZodType<RawNewsInput> = z.object({
  generated_at: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      title: z.string(),
      url: z.string(),
      published_at: z.string(),
      summary: z.string(),
    }),
  ),
});

export class NewsLoader {
  constructor(private readonly source: DataSource<RawNewsInput>) {}

  async loadItems(): Promise<NewsBriefingItem[]> {
    const raw = RawNewsSchema.parse(await this.source.load());
    return raw.items.map((item) => ({
      id: item.id,
      sourceType: "news",
      title: item.title,
      summary: item.summary,
      occurredAt: item.published_at,
      source: item.source,
      url: item.url,
      publishedAt: item.published_at,
      provenance: {
        sourceName: this.source.sourceName,
        originalId: item.id,
        origin: "file",
      },
    }));
  }
}
