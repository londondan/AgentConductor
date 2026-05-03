import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { readCursorHookTelemetry } from "../src/cursor-hook-telemetry.js";

test("reads root and subagent model events from Cursor hook telemetry JSONL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  await writeFile(
    telemetryPath,
    [
      JSON.stringify({ event: "sessionStart", conversationId: "root-1", sessionId: "root-1", model: "gpt-5.5-medium" }),
      JSON.stringify({ event: "subagentStop", parentConversationId: "root-1", subagentId: "toolu_123", model: "claude-sonnet-4.6" }),
    ].join("\n"),
  );

  const telemetry = await readCursorHookTelemetry(telemetryPath);

  assert.equal(telemetry.modelForConversation("root-1"), "gpt-5.5-medium");
  assert.equal(telemetry.modelForSubagentToolUse("root-1", "toolu_123"), "claude-sonnet-4.6");
});

test("hook recorder appends compact model events and returns no context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  const input = {
    hook_event_name: "sessionStart",
    conversation_id: "root-1",
    session_id: "root-1",
    model: "gpt-5.5-medium",
    composer_mode: "agent",
  };

  const result = spawnSync(process.execPath, ["hooks/record-model.cjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, AGENT_TREE_MODEL_EVENTS: telemetryPath },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  const lines = (await readFile(telemetryPath, "utf8")).trim().split("\n");
  const event = JSON.parse(lines[0]);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "{}");
  assert.equal(event.event, "sessionStart");
  assert.equal(event.conversationId, "root-1");
  assert.equal(event.model, "gpt-5.5-medium");
});
