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

The extension reads that file by default. Override with `agentTreeMonitor.modelTelemetryPath` or `AGENT_TREE_MODEL_EVENTS` if needed.

Supported joins:

- Root/session model: `sessionStart.conversation_id` or `session_id` matches the transcript session ID.
- Subagent model: `subagentStop.subagent_id` matches the parent transcript `tool_use.id` when Cursor records it.

If Cursor does not provide a subagent tool-use ID in both places, that subagent remains `unknown` rather than guessing.

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
