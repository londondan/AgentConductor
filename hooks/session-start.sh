#!/bin/bash
# session-start.sh — SessionStart hook
# Initialises the state file for this session.

set -euo pipefail

HOOK_INPUT=$(cat)

SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""')
CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // ""')

if [[ -z "$SESSION_ID" || -z "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

python3 "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.py" init \
  --session-id "$SESSION_ID" \
  --transcript-path "$TRANSCRIPT_PATH" \
  --cwd "$CWD"

exit 0
