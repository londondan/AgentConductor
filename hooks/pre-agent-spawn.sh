#!/bin/bash
# pre-agent-spawn.sh — PreToolUse hook (matcher: Agent|Task).
# Appends one JSONL line per spawn to ~/.claude/agent-conductor/spawns/<session_id>.jsonl,
# keyed by the *calling agent's* transcript path. tree.py merges this with
# transcript-derived edges to reconstruct nested subagent trees.
#
# Why a hook: when a subagent calls Agent/Task, Claude Code does not embed a
# tool_use_id or matching toolUseResult.agentId in the parent subagent's
# transcript, so transcript-only parsing can't link parent→grandchild.
# PreToolUse stdin carries `transcript_path` for the calling agent, which is
# the authoritative parent identity.

set -euo pipefail

SPAWNS_DIR="${HOME}/.claude/agent-conductor/spawns"
mkdir -p "$SPAWNS_DIR"

HOOK_INPUT=$(cat)

SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""')
TOOL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_name // ""')

[[ -z "$SESSION_ID" || -z "$TRANSCRIPT_PATH" ]] && exit 0
[[ "$TOOL_NAME" != "Agent" && "$TOOL_NAME" != "Task" ]] && exit 0

# caller_id = "root" if transcript basename is <session_id>.jsonl, else the
# short id from agent-<short>.jsonl.
BASENAME=$(basename "$TRANSCRIPT_PATH" .jsonl)
if [[ "$BASENAME" == "$SESSION_ID" ]]; then
  CALLER_ID="root"
elif [[ "$BASENAME" == agent-* ]]; then
  CALLER_ID="${BASENAME#agent-}"
else
  CALLER_ID="$BASENAME"
fi

SPAWNED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
LEDGER_FILE="${SPAWNS_DIR}/${SESSION_ID}.jsonl"

# Build the record with jq so tool_input fields are JSON-safe.
echo "$HOOK_INPUT" | jq -c \
  --arg session_id "$SESSION_ID" \
  --arg caller_id "$CALLER_ID" \
  --arg caller_transcript "$TRANSCRIPT_PATH" \
  --arg tool_name "$TOOL_NAME" \
  --arg spawned_at "$SPAWNED_AT" \
  '{
    session_id: $session_id,
    caller_id: $caller_id,
    caller_transcript: $caller_transcript,
    tool_name: $tool_name,
    subagent_type: (.tool_input.subagent_type // "general-purpose"),
    description: (.tool_input.description // ""),
    prompt_preview: ((.tool_input.prompt // "")[0:200]),
    spawned_at: $spawned_at
  }' >> "$LEDGER_FILE" || true

exit 0
