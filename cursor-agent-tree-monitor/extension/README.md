# Agent Tree Monitor Cursor Extension

This folder contains the no-terminal wrapper for the portable Agent Tree Monitor core.

## Open In Cursor

Use Cursor's extension development flow and point it at this folder:

```text
/Users/danjames/repo/dev/agent-tree-monitor/extension
```

Once loaded, open the `Agent Tree Monitor` Activity Bar view, or run this command from the Command Palette:

```text
Agent Tree Monitor: Open
```

The persistent sidebar webview refreshes every 2 seconds from the extension host. No terminal monitor process is required.

The extension also adds a status bar item with compact live counts, such as:

```text
Agents: 3 running · 1 high ctx
```

Click the status bar item to reveal the monitor view.

## Attachment Behavior

Cursor does not currently expose a documented active root-agent/session API to this wrapper. The extension attaches to the most recently active transcript session by default, based on transcript file modification time.

Use the `Select Session` button in the webview if the inferred session is wrong. The monitor keeps using transcript evidence; it does not claim exact attachment to Cursor's currently open root agent.

## Runtime Behavior

- Transcript JSONL reads are cached by path, mtime, and size.
- Growing transcript files are incrementally parsed where safe.
- Status is inferred as `running`, `waiting`, `stale`, `completed`, `failed`, or `unknown`.
- Subagent tool calls are paired with tool results by `tool_use_id` and surfaced as compact tool/error counts.

## Configuration

- `agentTreeMonitor.transcriptRoot`: optional override for the Cursor `agent-transcripts` directory.
- `agentTreeMonitor.refreshSeconds`: refresh interval, default `2`.
