# Daily Briefing Agent

TypeScript prototype for generating a 60-90 second personalized daily briefing from local profile, calendar, email, and news JSON inputs.

The original assignment prompt is preserved in `ASSIGNMENT.md`. Design decisions and trade-offs are documented in `DECISIONS.md`.

## Requirements

- Node.js 20+
- npm
- `CURSOR_API_KEY` for running the Cursor SDK agent

Tracing is optional. Set `TRACING_PROVIDER` to choose the backend:

- `langfuse` (default)
- `traceroot`
- `laminar` (`lmnr`)
- `braintrust` (`bt`)
- `noop` (also `none`, `off`, `false`, `disabled`)

If the selected provider is missing required API keys, tracing falls back to a no-op tracer.

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env` and set:

```bash
CURSOR_API_KEY=...
```

## Run

Generate `briefing.txt` and `briefing.json` from the default `inputs/` directory:

```bash
npm run briefing
```

Useful options:

```bash
npm run briefing -- --input-dir inputs --date 2026-05-15 --text-out briefing.txt --json-out briefing.json
npm run briefing -- --model composer-2.5 --max-revisions 2
npm run briefing -- --help
```

## Verify

```bash
npm test
npm run build
```

Current verification status:

- `npm test`: 18 test files passed, 80 tests passed
- `npm run build`: TypeScript build passed

## Outputs

- `briefing.txt`: plain English TTS text
- `briefing.json`: metadata with included input ids, discarded items, section ranges, word count, estimated duration, and must-include coverage

The checked-in output files were generated from the provided `inputs/` dataset.

## Project Structure

```text
src/
  agent/          Cursor SDK agent runner, prompts, and result parsing
  data/           JSON data source abstraction
  domain/         Shared types and contracts
  loaders/        Profile, calendar, email, and news loaders
  mcp/            Candidate search MCP tool runtime
  model/          Model-assisted source operation hooks
  observability/  Optional Langfuse tracing
  output/         Output metadata and file writing
  pipeline/       Source runtime wiring
  policy/         Jordan profile policy compiler
  processors/     Source filtering, scoring, tagging, privacy, spoken facts
  rules/          Rule expression evaluator
  validators/     Rule and heuristic judge validators
tests/            Unit tests for loaders, processors, tools, runner, validators, and output
inputs/           Provided assignment data
```

## Notes

The pipeline intentionally keeps deterministic filtering, scoring, privacy handling, and spoken-fact preparation outside the final generation prompt. The Daily Briefing Agent receives filtered and ranked candidates through MCP candidate/search tools, generates an outline and draft, then validators check the result before outputs are written.
