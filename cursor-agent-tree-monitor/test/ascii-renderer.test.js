import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSessionGraph } from "../src/core.js";
import { renderAsciiTree } from "../src/ascii-renderer.js";

test("renders a live monitor snapshot with aligned tree rows", () => {
  const graph = normalizeSessionGraph({
    session: {
      id: "117990af",
      environment: "cursor",
      label: "product",
      startedAt: "2026-05-02T15:00:00.000Z",
      now: "2026-05-02T16:23:00.000Z",
      refreshSeconds: 2,
      sort: "tree",
    },
    nodes: [
      {
        id: "root",
        type: "Root",
        summary: "Root orchestrator",
        status: "running",
        model: { name: "opus-4.7", confidence: "recorded" },
        context: { usedTokens: 923_000, limitTokens: 1_000_000, confidence: "recorded" },
        metrics: { inputTokens: 2_000_000, outputTokens: 100_000 },
        source: { adapter: "cursor_sdk", confidence: "recorded" },
      },
      {
        id: "plan",
        parentId: "root",
        type: "Plan",
        summary: "Design auth system",
        status: "running",
        model: { name: "sonnet-4.5", confidence: "recorded" },
        context: { usedTokens: 452_000, limitTokens: 1_000_000, confidence: "recorded" },
        metrics: { inputTokens: 400_000, outputTokens: 60_000 },
        source: { adapter: "cursor_sdk", confidence: "recorded" },
      },
      {
        id: "explore",
        parentId: "plan",
        type: "Explore",
        summary: "Search auth patterns",
        status: "completed",
        context: { usedTokens: 121_000, limitTokens: 1_000_000, confidence: "estimated" },
        metrics: { inputTokens: 20_000, outputTokens: 10_000, toolCount: 8, errorCount: 1 },
        source: { adapter: "cursor_transcript", confidence: "estimated" },
      },
    ],
  });

  const output = renderAsciiTree(graph, { width: 72, unicode: true });

  assert.match(output, /Session 117990af · cursor · product · elapsed 1h23m · refresh 2s/);
  assert.match(output, /3 agents · 2 running ▶ · in 2\.4M out 170k · ! 1 high context/);
  assert.match(output, /│ ▶ Root\s+92\.3%/);
  assert.match(output, /│ model opus-4\.7/);
  assert.match(output, /│ └─ ▶ \[Plan\] "Design auth system"\s+45\.2%/);
  assert.match(output, /│   model sonnet-4\.5/);
  assert.match(output, /│   └─ ✓ \[Explore\] "Search auth patterns"\s+12\.1%/);
  assert.match(output, /tools 8 · err 1/);
});

test("renders model source provenance and swap warning on the model sub-line", () => {
  const graph = normalizeSessionGraph({
    session: { id: "drift-session", environment: "cursor", refreshSeconds: 2 },
    nodes: [
      {
        id: "root",
        type: "Root",
        summary: "Drift demo",
        status: "running",
        model: { name: "claude-opus-4.7", confidence: "recorded" },
        context: { usedTokens: 100, limitTokens: 1_000, confidence: "estimated" },
        source: { adapter: "cursor_transcript", confidence: "estimated" },
        metadata: { modelSource: "cursor_hook_telemetry" },
      },
      {
        id: "drifted",
        parentId: "root",
        type: "explore",
        summary: "Drifted child",
        status: "completed",
        model: { name: "claude-opus-4.7", confidence: "recorded" },
        context: { usedTokens: 50, limitTokens: 1_000, confidence: "estimated" },
        source: { adapter: "cursor_transcript", confidence: "estimated" },
        metadata: {
          modelSource: "cursor_hook_order",
          modelSwapped: true,
          modelHistory: [
            { model: "claude-sonnet-4.6", recordedAt: "2026-05-03T14:40:00Z", event: "subagentStop" },
            { model: "claude-opus-4.7", recordedAt: "2026-05-03T14:42:00Z", event: "subagentStop" },
          ],
        },
      },
    ],
  });

  const output = renderAsciiTree(graph, { width: 80, unicode: true });

  assert.match(output, /model claude-opus-4\.7 \(hook\)/);
  assert.match(output, /model claude-opus-4\.7 \(hook ord\) ! swap: claude-sonnet-4\.6→claude-opus-4\.7/);
});

test("can render with ASCII-safe status and connector fallbacks", () => {
  const graph = normalizeSessionGraph({
    session: { id: "s1", environment: "generic", refreshSeconds: 2 },
    nodes: [
      {
        id: "root",
        type: "Root",
        summary: "Do work",
        status: "running",
        context: { usedTokens: 100, limitTokens: 1_000, confidence: "estimated" },
        source: { adapter: "fixture", confidence: "estimated" },
      },
    ],
  });

  const output = renderAsciiTree(graph, { width: 60, unicode: false });

  assert.match(output, /\| > Root/);
  assert.doesNotMatch(output, /[│└✓▶]/);
});
