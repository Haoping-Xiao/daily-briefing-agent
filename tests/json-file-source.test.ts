import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonFileSource } from "../src/data/json-file-source.js";
import type { RawCalendarInput, RawEmailInput, RawNewsInput, RawProfileInput } from "../src/domain/types.js";

describe("JsonFileSource", () => {
  it("loads the four provided input JSON files", async () => {
    const profile = await new JsonFileSource<RawProfileInput>("profile", "inputs/profile.json").load();
    const calendar = await new JsonFileSource<RawCalendarInput>("calendar", "inputs/calendar.json").load();
    const emails = await new JsonFileSource<RawEmailInput>("emails", "inputs/emails.json").load();
    const news = await new JsonFileSource<RawNewsInput>("news", "inputs/news.json").load();

    expect(profile.user.name).toBe("Jordan Chen");
    expect(calendar.events).toHaveLength(11);
    expect(emails.emails).toHaveLength(20);
    expect(news.items).toHaveLength(30);
  });

  it("reports parse failures with source context", async () => {
    const dir = join(tmpdir(), `briefing-json-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "bad.json");
    await writeFile(filePath, "{bad", "utf8");

    await expect(new JsonFileSource("bad-source", filePath).load()).rejects.toThrow(
      /Failed to parse bad-source JSON/,
    );

    await rm(dir, { recursive: true, force: true });
  });
});
