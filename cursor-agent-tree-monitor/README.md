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

## Core Pieces

- `src/core.js`: Portable graph normalization and context risk calculation.
- `src/adapters/interface.js`: Adapter contract for Cursor and future environments.
- `src/adapters/cursor-transcript.js`: Best-effort Cursor transcript ingestion.
- `src/adapters/cursor-sdk-telemetry.js`: Recorder for future SDK-launched runs.
- `src/ascii-renderer.js`: ASCII/Unicode tree renderer.
- `src/live-monitor.js`: Polling live monitor loop.
- `extension/`: Cursor side-panel wrapper for no-terminal viewing.
