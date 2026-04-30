#!/bin/bash
# stop.sh — Stop hook
# Fires when the root session finishes. Builds the full agent tree from
# transcripts and prints it. Also terminates the live monitor if running.

set -euo pipefail

HOOK_INPUT=$(cat)

SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""')
CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // ""')

if [[ -z "$SESSION_ID" || -z "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Kill live monitor if one is running for this session
PID_FILE="${HOME}/.claude/agent-conductor/${SESSION_ID}.pid"
if [[ -f "$PID_FILE" ]]; then
  MONITOR_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$MONITOR_PID" ]]; then
    kill "$MONITOR_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Mark state as terminated (for monitor graceful exit)
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.py" terminate \
  --session-id "$SESSION_ID" 2>/dev/null || true

# Generate and print the tree report
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/report.py" \
  --session-id "$SESSION_ID" \
  --transcript-path "$TRANSCRIPT_PATH" \
  --cwd "$CWD"

exit 0
