import test from "node:test";
import assert from "node:assert/strict";

import { CursorSdkTelemetryRecorder } from "../src/adapters/cursor-sdk-telemetry.js";

test("records SDK-launched agent telemetry as a portable graph", () => {
  const recorder = new CursorSdkTelemetryRecorder({
    sessionId: "117990af",
    environment: "cursor",
    label: "product",
    contextLimitTokens: 1_000_000,
  });

  recorder.recordRunStarted({
    agentId: "root",
    runId: "run-root",
    parentAgentId: null,
    type: "Root",
    summary: "Root orchestrator",
    model: "opus-4.7",
  });

  recorder.recordTokenUsage({ agentId: "root", inputTokens: 2_000_000, outputTokens: 100_000, contextTokens: 923_000 });

  recorder.recordRunStarted({
    agentId: "child",
    runId: "run-child",
    parentAgentId: "root",
    type: "Explore",
    summary: "Search auth patterns",
    model: "composer-2-fast",
  });

  recorder.recordRunFinished({ agentId: "child", status: "completed" });

  const graph = recorder.toSessionGraph();

  assert.equal(graph.session.id, "117990af");
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes[0].status, "running");
  assert.equal(graph.nodes[0].model.name, "opus-4.7");
  assert.equal(graph.nodes[0].context.usedTokens, 923_000);
  assert.equal(graph.nodes[1].parentId, "root");
  assert.equal(graph.nodes[1].status, "completed");
});
