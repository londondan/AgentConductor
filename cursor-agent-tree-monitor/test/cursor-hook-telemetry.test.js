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

test("hook recorder captures status, durationMs, and cursorVersion fields when present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  const input = {
    hook_event_name: "subagentStop",
    parent_conversation_id: "root-1",
    subagent_id: "toolu_abc",
    subagent_type: "general-purpose",
    model: "claude-opus-4-7-thinking-xhigh",
    status: "completed",
    duration_ms: 1374,
    cursor_version: "3.2.16",
  };

  spawnSync(process.execPath, ["hooks/record-model.cjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, AGENT_TREE_MODEL_EVENTS: telemetryPath },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  const event = JSON.parse((await readFile(telemetryPath, "utf8")).trim());

  assert.equal(event.status, "completed");
  assert.equal(event.durationMs, 1374);
  assert.equal(event.cursorVersion, "3.2.16");
  assert.equal(event.subagentType, "general-purpose");
});

test("hook recorder writes raw event payload only when AGENT_TREE_HOOK_DEBUG=1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  const rawPath = join(dir, "raw-events.jsonl");
  const input = { hook_event_name: "subagentStop", parent_conversation_id: "root", subagent_id: "toolu_x", model: "m" };

  spawnSync(process.execPath, ["hooks/record-model.cjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, AGENT_TREE_MODEL_EVENTS: telemetryPath, AGENT_TREE_RAW_EVENTS: rawPath, AGENT_TREE_HOOK_DEBUG: "0" },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  await assert.rejects(() => readFile(rawPath, "utf8"));

  spawnSync(process.execPath, ["hooks/record-model.cjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, AGENT_TREE_MODEL_EVENTS: telemetryPath, AGENT_TREE_RAW_EVENTS: rawPath, AGENT_TREE_HOOK_DEBUG: "1" },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  const raw = JSON.parse((await readFile(rawPath, "utf8")).trim());
  assert.equal(raw.event.subagent_id, "toolu_x");
  assert.equal(raw.event.hook_event_name, "subagentStop");
  assert.ok(typeof raw.recordedAt === "string");
});

test("subagentEventsForParent returns subagentStop events sorted chronologically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  await writeFile(
    telemetryPath,
    [
      JSON.stringify({ event: "subagentStop", recordedAt: "2026-05-03T14:40:39.707Z", parentConversationId: "root-1", subagentId: "toolu_3", model: "model-c" }),
      JSON.stringify({ event: "subagentStop", recordedAt: "2026-05-03T14:40:38.050Z", parentConversationId: "root-1", subagentId: "toolu_1", model: "model-a" }),
      JSON.stringify({ event: "subagentStop", recordedAt: "2026-05-03T14:40:39.141Z", parentConversationId: "root-1", subagentId: "toolu_2", model: "model-b" }),
      JSON.stringify({ event: "sessionStart", recordedAt: "2026-05-03T14:39:00.000Z", conversationId: "root-1", model: "root-model" }),
    ].join("\n"),
  );

  const telemetry = await readCursorHookTelemetry(telemetryPath);
  const events = telemetry.subagentEventsForParent("root-1");

  assert.equal(events.length, 3, "sessionStart should not appear in subagent ordinal list");
  assert.deepEqual(
    events.map((event) => event.subagentId),
    ["toolu_1", "toolu_2", "toolu_3"],
  );
  assert.equal(events[0].model, "model-a");
});

test("modelHistoryForSubagent returns ordered history for drift detection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  await writeFile(
    telemetryPath,
    [
      JSON.stringify({ event: "subagentStop", recordedAt: "2026-05-03T14:40:38.050Z", parentConversationId: "root-1", subagentId: "toolu_1", model: "claude-sonnet-4.6" }),
      JSON.stringify({ event: "subagentStop", recordedAt: "2026-05-03T14:42:00.000Z", parentConversationId: "root-1", subagentId: "toolu_1", model: "claude-opus-4.7" }),
    ].join("\n"),
  );

  const telemetry = await readCursorHookTelemetry(telemetryPath);
  const history = telemetry.modelHistoryForSubagent("root-1", "toolu_1");

  assert.equal(history.length, 2);
  assert.equal(history[0].model, "claude-sonnet-4.6");
  assert.equal(history[1].model, "claude-opus-4.7");
});

test("modelHistoryForConversation excludes subagentStop events to prevent root drift contamination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  // Cursor sets `conversation_id` on subagentStop events to the PARENT
  // conversation. Without filtering, root's modelHistoryForConversation would
  // appear to "swap" every time a subagent uses a different model.
  await writeFile(
    telemetryPath,
    [
      JSON.stringify({ event: "sessionStart", recordedAt: "2026-05-03T14:39:00.000Z", conversationId: "root-1", model: "root-model" }),
      JSON.stringify({ event: "subagentStop", recordedAt: "2026-05-03T14:40:00.000Z", conversationId: "root-1", parentConversationId: "root-1", subagentId: "toolu_1", model: "different-model" }),
      JSON.stringify({ event: "subagentStop", recordedAt: "2026-05-03T14:41:00.000Z", conversationId: "root-1", parentConversationId: "root-1", subagentId: "toolu_2", model: "yet-another-model" }),
    ].join("\n"),
  );

  const telemetry = await readCursorHookTelemetry(telemetryPath);
  const history = telemetry.modelHistoryForConversation("root-1");

  assert.equal(history.length, 1, "should not include subagent events");
  assert.equal(history[0].model, "root-model");
  assert.equal(history[0].event, "sessionStart");
});

test("modelHistoryForConversation captures repeated identical sessionStart events without false drift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-hooks-"));
  const telemetryPath = join(dir, "model-events.jsonl");
  await writeFile(
    telemetryPath,
    [
      JSON.stringify({ event: "sessionStart", recordedAt: "2026-05-03T14:00:00.000Z", conversationId: "root-1", model: "claude-opus" }),
      JSON.stringify({ event: "sessionStart", recordedAt: "2026-05-03T14:30:00.000Z", conversationId: "root-1", model: "claude-opus" }),
    ].join("\n"),
  );

  const telemetry = await readCursorHookTelemetry(telemetryPath);
  const history = telemetry.modelHistoryForConversation("root-1");
  const distinctModels = new Set(history.map((entry) => entry.model));

  assert.equal(history.length, 2);
  assert.equal(distinctModels.size, 1, "repeated identical models are not drift");
});
