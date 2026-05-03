import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateContextRisk,
  normalizeSessionGraph,
} from "../src/core.js";

test("normalizes adapter nodes and edges into a portable session graph", () => {
  const graph = normalizeSessionGraph({
    session: {
      id: "117990af",
      environment: "cursor",
      label: "product",
      startedAt: "2026-05-02T15:00:00.000Z",
    },
    nodes: [
      {
        id: "root",
        parentId: null,
        type: "Root",
        summary: "Build monitor",
        status: "running",
        model: { name: "opus-4.7", confidence: "recorded" },
        context: { usedTokens: 923_000, limitTokens: 1_000_000, confidence: "recorded" },
        source: { adapter: "cursor_sdk", confidence: "recorded" },
      },
      {
        id: "child",
        parentId: "root",
        type: "Explore",
        summary: "Search transcripts",
        status: "completed",
        context: { usedTokens: 121_000, limitTokens: 1_000_000, confidence: "estimated" },
        source: { adapter: "cursor_transcript", confidence: "estimated" },
      },
    ],
  });

  assert.equal(graph.session.id, "117990af");
  assert.equal(graph.roots.length, 1);
  assert.equal(graph.roots[0].id, "root");
  assert.equal(graph.roots[0].children[0].id, "child");
  assert.equal(graph.nodesById.get("child").risk.percent, 12.1);
});

test("calculates context risk from exact, estimated, and unknown metrics", () => {
  assert.deepEqual(
    calculateContextRisk({ usedTokens: 923_000, limitTokens: 1_000_000, confidence: "recorded" }),
    { kind: "high", percent: 92.3, confidence: "recorded" },
  );

  assert.deepEqual(
    calculateContextRisk({ usedTokens: 452_000, limitTokens: 1_000_000, confidence: "estimated" }),
    { kind: "normal", percent: 45.2, confidence: "estimated" },
  );

  assert.deepEqual(calculateContextRisk(undefined), {
    kind: "unknown",
    percent: null,
    confidence: "unknown",
  });
});
