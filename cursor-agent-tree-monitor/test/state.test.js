import test from "node:test";
import assert from "node:assert/strict";

import { inferAgentStatus } from "../src/state.js";

const now = new Date("2026-05-03T13:00:00.000Z");

test("infers running from recent non-terminal transcript activity", () => {
  assert.deepEqual(
    inferAgentStatus({
      now,
      modifiedAt: new Date("2026-05-03T12:59:30.000Z"),
      lines: [{ role: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }],
    }),
    { status: "running", confidence: "inferred", reason: "recent_non_terminal_activity" },
  );
});

test("infers waiting from recent assistant text with no active tool", () => {
  assert.deepEqual(
    inferAgentStatus({
      now,
      modifiedAt: new Date("2026-05-03T12:59:30.000Z"),
      lines: [{ role: "assistant", message: { content: [{ type: "text", text: "Done, waiting for input." }] } }],
    }),
    { status: "waiting", confidence: "inferred", reason: "recent_assistant_text" },
  );
});

test("infers stale from old non-terminal activity", () => {
  assert.deepEqual(
    inferAgentStatus({
      now,
      modifiedAt: new Date("2026-05-03T12:30:00.000Z"),
      lines: [{ role: "assistant", message: { content: [{ type: "tool_use", name: "Shell" }] } }],
    }),
    { status: "stale", confidence: "inferred", reason: "old_non_terminal_activity" },
  );
});

test("infers failed from tool result errors", () => {
  assert.deepEqual(
    inferAgentStatus({
      now,
      modifiedAt: now,
      lines: [{ role: "user", message: { content: [{ type: "tool_result", is_error: true }] } }],
    }),
    { status: "failed", confidence: "inferred", reason: "tool_result_error" },
  );
});

test("infers completed from terminal completion text", () => {
  assert.deepEqual(
    inferAgentStatus({
      now,
      modifiedAt: now,
      lines: [{ role: "assistant", message: { content: [{ type: "text", text: "Task completed successfully." }] } }],
    }),
    { status: "completed", confidence: "inferred", reason: "completion_marker" },
  );
});
