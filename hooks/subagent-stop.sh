#!/bin/bash
# subagent-stop.sh — SubagentStop hook
# Fires when a subagent finishes. Reads the subagent's transcript to get
# peak token usage and updates the state file.

set -euo pipefail

HOOK_INPUT=$(cat)

SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')

if [[ -z "$SESSION_ID" ]]; then
  exit 0
fi

python3 "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.py" update \
  --session-id "$SESSION_ID" \
  --hook-input "$HOOK_INPUT"

exit 0
