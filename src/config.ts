import { resolve } from "node:path";

export interface CliOptions {
  inputDir: string;
  briefingDate: string;
  outputTextPath: string;
  outputJsonPath: string;
  model: string;
  maxRevisions: number;
}

export function parseCliOptions(argv: string[], cwd = process.cwd()): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    throw new HelpRequested(helpText());
  }

  const get = (name: string, fallback: string): string => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };

  const getNumber = (name: string, fallback: number): number => {
    const raw = get(name, String(fallback));
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
    return parsed;
  };

  return {
    inputDir: resolve(cwd, get("--input-dir", "inputs")),
    briefingDate: get("--date", "2026-05-15"),
    outputTextPath: resolve(cwd, get("--text-out", "briefing.txt")),
    outputJsonPath: resolve(cwd, get("--json-out", "briefing.json")),
    model: get("--model", "composer-2.5"),
    maxRevisions: getNumber("--max-revisions", 2),
  };
}

export function requireCursorApiKey(env = process.env): string {
  const apiKey = env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required to run the Cursor SDK agent.");
  }
  return apiKey;
}

export class HelpRequested extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelpRequested";
  }
}

export function helpText(): string {
  return [
    "Usage: npm run briefing -- [options]",
    "",
    "Options:",
    "  --input-dir <path>       Input JSON directory. Default: inputs",
    "  --date <yyyy-mm-dd>      Briefing date. Default: 2026-05-15",
    "  --text-out <path>        TTS output path. Default: briefing.txt",
    "  --json-out <path>        Metadata output path. Default: briefing.json",
    "  --model <id>             Cursor model id. Default: composer-2.5",
    "  --max-revisions <n>      Max validation revision attempts. Default: 2",
  ].join("\n");
}
