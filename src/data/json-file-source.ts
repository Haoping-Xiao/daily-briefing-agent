import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DataSource } from "../domain/types.js";

export class JsonFileSource<T> implements DataSource<T> {
  readonly sourceName: string;
  private readonly filePath: string;

  constructor(sourceName: string, filePath: string) {
    this.sourceName = sourceName;
    this.filePath = resolve(filePath);
  }

  async load(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      throw new Error(`Failed to read ${this.sourceName} from ${this.filePath}: ${messageOf(error)}`);
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new Error(`Failed to parse ${this.sourceName} JSON from ${this.filePath}: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
