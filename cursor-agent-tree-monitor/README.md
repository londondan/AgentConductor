# Agent Tree Monitor

A portable live monitor for orchestrator and subagent trees. Cursor is the first adapter, but the core graph model, risk calculation, renderer, and polling loop are environment-agnostic.

## Run A Cursor Transcript Snapshot

```bash
node src/cli.js --root /path/to/agent-transcripts --session latest --once
```

## Run Live

```bash
node src/cli.js --root /path/to/agent-transcripts --session latest --refresh 2
```

The live monitor repaints every 2 seconds. Transcript-only data is best-effort: tree structure and summaries can be inferred, but model and exact context usage are marked unknown or estimated unless an instrumented adapter provides stronger telemetry.

## Open Without A Terminal

The Cursor extension wrapper lives in `extension/`. Load that folder through Cursor's extension development flow, then run this Command Palette command:

```text
Agent Tree Monitor: Open
```

The side webview follows the most recently active Cursor transcript by default and refreshes every 2 seconds. Use `Select Session` in the webview if the inferred session is not the root agent you want.

## Capture Cursor Model Telemetry

Cursor transcript JSONL usually does not include the model chosen for a session or subagent. Cursor hooks do receive that model in their event input, so the monitor can merge hook telemetry into the transcript-derived tree.

Install the example hook config into the workspace or user hook location:

```bash
cp hooks/hooks.example.json /Users/danjames/repo/dev/.cursor/hooks.json
```

The hook records compact model events to:

```text
~/.cursor/agent-tree-monitor/model-events.jsonl
```

The CLI and extension read that file by default. Override with `agentTreeMonitor.modelTelemetryPath`, the `AGENT_TREE_MODEL_EVENTS` environment variable, or the CLI flags `--model-telemetry <path>` / `--no-model-telemetry`.

### Subagent attribution joins (in priority order)

1. **`modelForConversation`** — direct match by Cursor `conversation_id` / `session_id`. Used for the root orchestrator.
2. **`modelForSubagentToolUse`** — direct match by `parent_conversation_id` + `subagent_id` (the Cursor tool-use ID). Provided for compatibility, but Cursor does not currently record that ID in transcript JSONL, so this lookup is rarely satisfied.
3. **Ordinal matching by completion time** — the adapter groups all `subagentStop` events by `parent_conversation_id`, sorts by `recordedAt`, sorts the parent's child transcripts by completion mtime, and assigns the Nth event to the Nth child. Provenance is tagged `cursor_hook_order` so consumers can downgrade trust.

If none of the above resolve a model, the subagent's model remains `unknown` rather than guessing.

### Diagnose hook payloads

Cursor's hook payload schema is not formally documented. To capture the raw event JSON for inspection, set `AGENT_TREE_HOOK_DEBUG=1` in the hook command. The script will append every event payload to `~/.cursor/agent-tree-monitor/raw-events.jsonl` (override with `AGENT_TREE_RAW_EVENTS=<path>`). Disable in production — the file grows unbounded.

### Model swap (drift) detection

When the same conversation or subagent fires multiple hook events with different `model` values, the monitor flags the node:

- `node.metadata.modelSwapped: true` and `node.metadata.modelHistory` lists every recorded model in chronological order.
- The ASCII renderer appends `! swap: <first>→<last>` to the model sub-line.
- The extension webview applies the `node-model-swapped` row class so the line stands out in warning color.

Drift is only flagged when the recorded model name actually changes — repeated identical events do not trigger a warning.

## Core Pieces

- `src/core.js`: Portable graph normalization and context risk calculation.
- `src/adapters/interface.js`: Adapter contract for Cursor and future environments.
- `src/adapters/cursor-transcript.js`: Best-effort Cursor transcript ingestion.
- `src/cursor-hook-telemetry.js`: Reads model telemetry captured by Cursor hooks.
- `hooks/record-model.cjs`: Cursor hook script that records model events without blocking agents.
- `src/adapters/cursor-sdk-telemetry.js`: Recorder for future SDK-launched runs.
- `src/ascii-renderer.js`: ASCII/Unicode tree renderer.
- `src/live-monitor.js`: Polling live monitor loop.
- `extension/`: Cursor side-panel wrapper for no-terminal viewing.
