# Agent Conductor

A Claude Code plugin for monitoring multi-agent flows. Tracks all subagents spawned during a session, their nesting depth, and what percentage of the context window each used — helping you identify where context rot may be degrading output quality.

## Features

- **Auto report** — At the end of every query, prints a tree of all agents and their peak context usage
- **Live monitor** — Run in a second terminal to watch agents spawn and context grow in real time
- **Rot warnings** — Agents that used >70% of the context window are flagged with ⚠

## Example Report Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Agent Conductor  |  session 1d541bcd  |  my-project
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Root  (sonnet-4-6)
├── [Explore] "Explore project directory structure"
│        46.0%  █████████░░░░░░░░░░░  completed
│   └── [general-purpose] "Deep search sub-task"
│            78.3%  ████████████████░░░░  completed  ⚠
└── [Plan] "Design implementation approach"
         22.1%  ████░░░░░░░░░░░░░░░░  completed

  Total agents: 4  |  Context window: 200k tokens
  ⚠  1 agent(s) used >70% context (potential rot risk)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Live Monitor

Open a second terminal window and run:

```bash
python3 ~/.claude/plugins/agent-conductor/scripts/monitor.py
```

The monitor auto-discovers the most recently active session. It updates every 2 seconds showing:
- All spawned agents with their current context usage
- Running agents highlighted in green
- Warning in red for agents approaching context limits

Press `q` or `Ctrl+C` to exit.

To monitor a specific session:
```bash
python3 ~/.claude/plugins/agent-conductor/scripts/monitor.py --session-id <SESSION_ID>
```

## Manual Report

You can also trigger the report manually at any point during a session using:
```
/agent-report
```

## How It Works

- **SessionStart hook** — Initialises a state file at `~/.claude/agent-conductor/<session-id>.json`
- **PreToolUse hook (Agent)** — Captures pending subagent info for the live monitor
- **SubagentStop hook** — Reads each completed subagent's transcript for peak token usage
- **Stop hook** — Builds the full agent tree and prints the report

Context window % is calculated as:
```
peak_input_tokens / 200,000 * 100
```

Where `peak_input_tokens` is the highest total input token count seen at any single API call during that agent's lifetime (including cache tokens).

## State Files

State files are written to `~/.claude/agent-conductor/` and persist until the next time you run a session. Old files are not automatically cleaned up — you can safely delete them manually.

## Requirements

- Python 3.9+
- `jq` (for hook shell scripts)
- `curses` (included in Python standard library)
