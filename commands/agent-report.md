---
name: agent-report
description: Show the agent hierarchy tree and context window usage for the current session
---

Generate an agent tree report for the current session showing all spawned subagents and their context window usage percentages.

Steps:
1. Find the current session's transcript path — it was provided in the SessionStart hook and stored in `~/.claude/agent-conductor/<session-id>.json`. You can also find it by looking at the most recently modified `.jsonl` file in `~/.claude/projects/`.

2. Run the report script:
```bash
python3 ~/.claude/plugins/agent-conductor/scripts/report.py \
  --session-id <SESSION_ID> \
  --transcript-path <TRANSCRIPT_PATH> \
  --cwd "$PWD"
```

3. Display the output to the user exactly as printed — it contains the formatted agent tree with context percentages.

Note: This command can be run at any point during or after a session. The Stop hook runs it automatically at the end of each query, so you only need this for a mid-session check.
