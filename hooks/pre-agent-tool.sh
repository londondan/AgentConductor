#!/bin/bash
# pre-agent-tool.sh — PreToolUse hook (matcher: Agent)
# Fires before an Agent tool call. We read the subagent_type + description
# from the tool input so that the state file has pending entries the live
# monitor can display immediately, before SubagentStop fires.

set -euo pipefail

HOOK_INPUT=$(cat)

SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
SUBAGENT_TYPE=$(echo "$HOOK_INPUT" | jq -r '.tool_input.subagent_type // "general-purpose"')
DESCRIPTION=$(echo "$HOOK_INPUT" | jq -r '.tool_input.description // ""')

if [[ -z "$SESSION_ID" ]]; then
  exit 0
fi

STATE_DIR="${HOME}/.claude/agent-conductor"
STATE_FILE="${STATE_DIR}/${SESSION_ID}.json"

if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# Append a pending entry to the state file using Python (handles JSON atomically)
python3 - <<PYEOF
import json, sys, os, time
from pathlib import Path

state_file = Path("${STATE_FILE}")
try:
    state = json.loads(state_file.read_text())
except Exception:
    sys.exit(0)

# Use a timestamp-based placeholder ID (will be resolved via transcript later)
pending_id = f"pending_{int(time.time() * 1000)}"
state["agents"][pending_id] = {
    "agent_id": pending_id,
    "parent": "root",
    "agent_type": "${SUBAGENT_TYPE}",
    "description": "${DESCRIPTION}",
    "prompt_preview": "",
    "transcript_path": None,
    "peak_input_tokens": 0,
    "model": "claude-sonnet-4-6",
    "status": "running",
    "children": [],
    "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "completed_at": None,
    "pending": True,
}
if "root" in state["agents"]:
    state["agents"]["root"]["children"].append(pending_id)

tmp = state_file.with_suffix(".tmp")
tmp.write_text(json.dumps(state, indent=2))
tmp.rename(state_file)
PYEOF

exit 0
