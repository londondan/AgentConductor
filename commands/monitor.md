---
name: monitor
description: Print the command to launch the AgentConductor live monitor in a separate terminal
---

Help the user open the live monitor window.

Steps:
1. Read `~/.claude/agent-conductor/sessions/<session_id>.json` for the current session — find it by checking the most recently modified file in that directory.
2. Print this command for the user to copy-paste into a NEW terminal window:
```bash
python3 /Users/danjames/AgentConductor/scripts/monitor.py --session-id <SESSION_ID>
```
3. Tell them the monitor uses curses and needs its own terminal (not this Claude Code terminal).
4. If no session metadata exists, tell them the SessionStart hook hasn't fired yet — they need to restart Claude Code for the hook to run.
