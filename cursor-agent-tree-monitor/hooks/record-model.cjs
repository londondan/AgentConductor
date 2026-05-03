#!/usr/bin/env node

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
    transcriptPath: clean(event.transcript_path),
    agentTranscriptPath: clean(event.agent_transcript_path),
  };
}

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
