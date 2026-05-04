#!/bin/bash
# session-start.sh — record session metadata, launch live monitor.
# v2: no state mutation. Just notes which transcript belongs to this session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
SESSIONS_DIR="${HOME}/.claude/agent-conductor/sessions"
mkdir -p "$SESSIONS_DIR"

HOOK_INPUT=$(cat)
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""')
CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // ""')

[[ -z "$SESSION_ID" || -z "$TRANSCRIPT_PATH" ]] && exit 0

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
META_FILE="${SESSIONS_DIR}/${SESSION_ID}.json"

cat > "$META_FILE" <<EOF
{
  "session_id": "${SESSION_ID}",
  "transcript_path": "${TRANSCRIPT_PATH}",
  "cwd": "${CWD}",
  "started_at": "${STARTED_AT}"
}
EOF

# Launch monitor in a background Terminal window (no focus steal)
osascript -e "tell application \"Terminal\" to do script \"python3 '${PLUGIN_ROOT}/scripts/monitor.py' --session-id '${SESSION_ID}'\"" 2>/dev/null || true

exit 0
