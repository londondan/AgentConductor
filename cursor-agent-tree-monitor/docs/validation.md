# Validation Strategy

Validation is fixture-based so the portable core can be tested without live Cursor internals.

## Core Fixtures

- One root with no children.
- A deeply nested orchestrator tree.
- Multiple roots in one session.
- Missing parent IDs, which should promote affected nodes to roots.

## Risk Fixtures

- `unknown`: no context metrics.
- `normal`: below `75%`.
- `warning`: `75%` through `89.9%`.
- `high`: `90%` and above.
- Confidence preservation for `recorded` and `estimated` metrics.

## Cursor Transcript Fixtures

- Root transcript plus one child under `subagents/`.
- `Task` tool call with `resume`, `description`, `subagent_type`, and `prompt`.
- Transcript cache cases: unchanged file, appended file, and shrunk file.
- Status inference cases: `running`, `waiting`, `stale`, `failed`, `completed`, and `unknown`.
- Subagent tool attribution by paired `tool_use` and `tool_result` blocks.
- Missing child transcript file.
- Malformed JSONL line, once strict error handling is added.
- Nested subagent transcript directories.

## SDK Telemetry Fixtures

- Root run started with recorded model.
- Child run linked to a parent agent ID.
- Token usage recorded after run start.
- Completed and failed terminal statuses.

The current automated tests cover the portable schema, risk calculation, ASCII/Unicode rendering, live polling loop, CLI argument parsing, Cursor transcript ingestion, transcript caching, inferred status states, subagent tool attribution, extension manifest contributions, webview payloads, and SDK telemetry recording.
