#!/usr/bin/env node

// Cursor hook: records compact model telemetry events to a jsonl file so that
// `cursor-agent-tree-monitor` can attribute each subagent's model.
//
// Environment variables:
//   AGENT_TREE_MODEL_EVENTS   Override the path to the compact telemetry jsonl
//                             (default: ~/.cursor/agent-tree-monitor/model-events.jsonl).
//   AGENT_TREE_HOOK_DEBUG     When set to "1", also append the full raw event
//                             payload to AGENT_TREE_RAW_EVENTS for diagnostic
//                             inspection. Use this to discover which fields
//                             Cursor actually provides per hook event.
//   AGENT_TREE_RAW_EVENTS     Override the path to the raw debug jsonl
//                             (default: ~/.cursor/agent-tree-monitor/raw-events.jsonl).

const { appendFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { homedir } = require("node:os");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input || "{}");

    if (process.env.AGENT_TREE_HOOK_DEBUG === "1") {
      writeRawEvent(event);
    }

    const record = compactModelEvent(event);
    if (record) {
      const outputPath = process.env.AGENT_TREE_MODEL_EVENTS || join(homedir(), ".cursor", "agent-tree-monitor", "model-events.jsonl");
      mkdirSync(dirname(outputPath), { recursive: true });
      appendFileSync(outputPath, `${JSON.stringify(record)}\n`, "utf8");
    }
  } catch {
    // Hooks should never block agent execution just because telemetry failed.
  }

  process.stdout.write("{}\n");
});

function writeRawEvent(event) {
  try {
    const rawPath = process.env.AGENT_TREE_RAW_EVENTS || join(homedir(), ".cursor", "agent-tree-monitor", "raw-events.jsonl");
    mkdirSync(dirname(rawPath), { recursive: true });
    const envelope = {
      recordedAt: new Date().toISOString(),
      event,
    };
    appendFileSync(rawPath, `${JSON.stringify(envelope)}\n`, "utf8");
  } catch {
    // Diagnostic logging must never break the hook.
  }
}

// Compact telemetry record schema (one line per matching hook event).
//
// Cursor's `subagentStop` payload (verified against `raw-events.jsonl` at the
// time of writing) does NOT include a usable child transcript path
// (`agent_transcript_path` is sent as `null`) and the parent transcript JSONL
// does not record `tool_use_id` for `Task` calls. Therefore the only reliable
// way to attribute a recorded model to a specific child subagent transcript is
// by completion ORDER per parent conversation.
//
// The reader (`src/cursor-hook-telemetry.js`) groups events by
// `parentConversationId`, sorts them by `recordedAt`, and matches the Nth
// completed event to the Nth completed child transcript for that parent.
// `subagentId` (Cursor's tool-use ID) is preserved so that drift detection can
// distinguish multiple events for the same child if Cursor swaps its model.
function compactModelEvent(event) {
  const model = clean(event.model);
  if (!model) return null;

  return {
    recordedAt: new Date().toISOString(),
    event: clean(event.hook_event_name),
    conversationId: clean(event.conversation_id),
    sessionId: clean(event.session_id),
    parentConversationId: clean(event.parent_conversation_id),
    generationId: clean(event.generation_id),
    subagentId: clean(event.subagent_id),
    subagentType: clean(event.subagent_type),
    model,
    status: clean(event.status),
    durationMs: cleanNumber(event.duration_ms),
    cursorVersion: clean(event.cursor_version),
    transcriptPath: clean(event.transcript_path),
    agentTranscriptPath: clean(event.agent_transcript_path),
  };
}

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}
