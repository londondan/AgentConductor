# Agent Conductor

A Claude Code plugin for monitoring multi-agent flows. Auto-launches a live tree view in a separate terminal window when a session starts, so you can watch agents spawn and context usage grow in real time — including subagents that spawn their own subagents, at any depth.

## How It Works (v2)

The plugin reads Claude Code's transcript files directly (`~/.claude/projects/...`) — they are the primary source of truth for the agent tree. The tree is rebuilt every refresh by walking the root transcript and recursively descending into each subagent's transcript.

- **Two hooks** — `SessionStart` writes session metadata and launches the monitor; a `PreToolUse(Agent|Task)` hook appends a one-line spawn record to `~/.claude/agent-conductor/spawns/<session_id>.jsonl` so the monitor can recover parent→child edges that aren't recorded in subagent transcripts
- **Live monitor** — Reads transcripts (with mtime caching), merges the spawn ledger, builds the tree, renders a scrollable curses UI
- **Scales** — mtime caching means stable subtrees cost nothing per refresh; hundreds of agents are fine

### Why the spawn ledger

When a subagent spawns its own subagent (e.g. a `general-purpose` agent calling Task), Claude Code writes the grandchild transcript flat under the root session's `subagents/` directory but does not embed a `tool_use_id` or `toolUseResult.agentId` in the parent subagent's transcript. Transcript-only parsing therefore can't link grandchildren to their actual parent. The PreToolUse hook captures `transcript_path` (the calling agent's identity) at spawn time and records it in the ledger; `tree.py` matches each ledger event to the subsequently-created subagent file by ctime ordering.

## Auto-Launch

When you start a Claude Code session, a new Terminal window opens automatically with the live monitor for that session. It runs in parallel and doesn't steal focus.

## Manual Launch

```bash
python3 /Users/danjames/AgentConductor/scripts/monitor.py
```

You'll see a numbered list of recent sessions. Pick one or press Enter for the latest. To skip the picker:

```bash
python3 /Users/danjames/AgentConductor/scripts/monitor.py --session-id <id>
```

## Keys

| Key | Action |
|-----|--------|
| `↑` `↓` / `j` `k` | Move cursor |
| `PgUp` `PgDn` | Page scroll |
| `g` / `G` | Top / bottom |
| `s` | Cycle sort: tree / tokens / recency |
| `/` | Filter by type or description |
| `d` | Detail panel for selected agent |
| `r` | Force refresh |
| `q` / `Esc` | Quit |

## Layout

```
┌─ Agent Conductor — 14:32:07 ─────────────────────────────────────┐
│ Session 117990af  ·  product  ·  elapsed 1h23m  ·  refresh 2s   │
│ 47 agents · 3 running ▶ · in 2.4M out 180k · ⚠ 5 high context   │
│ sort: tree                                                       │
├──────────────────────────────────────────────────────────────────┤
│ ▶ Root [opus-4.7]                                  92.3%  ▓▓▓▓▓░ │
│ └─ ▶ [Plan] "Design auth system"                   45.2%  ▓▓░░░░ │
│   └─ ✓ [Explore] "Search auth patterns"            12.1%  ▓░░░░░ │
│ └─ ✓ [Explore] "Find existing tests"               23.5%  ▓░░░░░ │
│   └─ ✓ [code-reviewer] "Review draft"              45.7%  ▓▓░░░░ │
└──────────────────────────────────────────────────────────────────┘
```

## Files

- `hooks/hooks.json` — Claude Code hook registration (SessionStart + PreToolUse)
- `hooks/session-start.sh` — writes session metadata, launches monitor
- `hooks/pre-agent-spawn.sh` — appends spawn events to the ledger on Agent/Task calls
- `scripts/tree.py` — transcript walker + ledger merger, builds the tree with mtime caching
- `scripts/monitor.py` — curses TUI
- `commands/monitor.md` — `/monitor` slash command (prints launch instructions)
- `cursor-agent-tree-monitor/` — temporary Cursor-side agent tree monitor and extension wrapper for Cursor JSONL transcripts

## Cursor Agent Tree Monitor

The Cursor monitor lives in `cursor-agent-tree-monitor/` while we decide how to collapse the Cursor and Agent Conductor surfaces together. It includes:

- a portable agent graph core and ASCII renderer
- a Cursor transcript adapter with recursive subagent discovery
- a Cursor/VS Code webview extension wrapper
- tests for live transcript parsing, context-risk rendering, session picking, and colored webview rows

Run its test suite directly from the subproject:

```bash
cd cursor-agent-tree-monitor
node --test test/*.test.js extension/test/*.test.cjs
```

## Storage

- `~/.claude/agent-conductor/sessions/<session_id>.json` — session metadata (one write per session)
- `~/.claude/agent-conductor/sessions/<session_id>.pid` — monitor PID (cleaned up on quit)
- `~/.claude/agent-conductor/spawns/<session_id>.jsonl` — append-only ledger of every Agent/Task spawn keyed by the calling agent's transcript_path

The tree is derived from transcripts plus the spawn ledger; the monitor itself never mutates state.

## Requirements

- macOS (uses Terminal.app via `osascript` for auto-launch; manual launch works anywhere)
- Python 3.9+
- `jq` (for the hook script)
