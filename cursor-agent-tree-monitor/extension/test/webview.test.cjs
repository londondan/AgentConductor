const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSnapshotRowClasses, buildWebviewHtml, buildSessionItems, buildStatusSummary, createMonitorSnapshot } = require("../src/webview.cjs");

test("builds webview HTML with a monitor container and select-session command", () => {
  const html = buildWebviewHtml({ nonce: "abc123" });

  assert.match(html, /Agent Tree Monitor/);
  assert.match(html, /id="snapshot"/);
  assert.match(html, /selectSession/);
  assert.match(html, /node-running/);
  assert.match(html, /renderSnapshot/);
  assert.match(html, /script nonce="abc123"/);
});

test("maps sessions to quick-pick items newest first", () => {
  const items = buildSessionItems([
    { id: "old-session-id", shortId: "old-sess", summary: "Older task", lastActivityAt: "2026-05-02T20:00:00.000Z", agentCount: 2 },
    { id: "new-session-id", shortId: "new-sess", summary: "Newer task", lastActivityAt: "2026-05-02T22:00:00.000Z", agentCount: 6 },
  ], { now: new Date("2026-05-02T23:00:00.000Z"), locale: "en-US", timeZone: "America/New_York" });

  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["new-session-id", "old-session-id"],
  );
  assert.equal(items[0].label, "Newer task");
  assert.equal(items[0].description, "Last active 6:00 PM · 6 agents · new-sess");
  assert.equal(items[0].detail, "new-session-id");
});

test("truncates long session picker labels and falls back for missing metadata", () => {
  const longSummary = "A".repeat(90);
  const items = buildSessionItems([
    { id: "abc12345-missing", summary: longSummary, lastActivityAt: "not-a-date" },
  ], { now: new Date("2026-05-02T23:00:00.000Z"), locale: "en-US", timeZone: "America/New_York" });

  assert.equal(items[0].label.length, 70);
  assert.equal(items[0].label.endsWith("…"), true);
  assert.equal(items[0].description, "Last active unknown · abc12345");
  assert.equal(items[0].detail, "abc12345-missing");
});

test("creates a webview payload from adapter graph data", async () => {
  const adapter = {
    async listSessions() {
      return [{ id: "latest-id", lastActivityAt: "2026-05-02T22:00:00.000Z" }];
    },
    async loadSessionGraph(sessionId) {
      assert.equal(sessionId, "latest-id");
      return {
        session: { id: "latest-id", environment: "cursor", refreshSeconds: 2 },
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
      };
    },
  };

  const payload = await createMonitorSnapshot({
    adapter,
    sessionId: "latest",
    render: () => "rendered tree",
  });

  assert.deepEqual(payload, {
    type: "snapshot",
    attached: "latest active transcript",
    sessionId: "latest-id",
    status: "Agents: 1 running · 0 high ctx",
    text: "rendered tree",
    rowClasses: ["snapshot-meta"],
  });
});

test("builds row classes for colored webview agent states", () => {
  const rowClasses = buildSnapshotRowClasses({
    nodes: [
      { id: "root", status: "running", risk: { kind: "normal" }, metrics: {} },
      { id: "completed", parentId: "root", status: "completed", risk: { kind: "normal" }, metrics: { toolCount: 1 } },
      { id: "high", parentId: "root", status: "completed", risk: { kind: "high" }, metrics: {} },
      { id: "warning", parentId: "root", status: "waiting", risk: { kind: "warning" }, metrics: {} },
    ],
  });

  assert.deepEqual(rowClasses, [
    "snapshot-meta",
    "snapshot-meta",
    "snapshot-meta",
    "snapshot-meta",
    "node-running",
    "node-completed",
    "node-completed node-tools",
    "node-high-context",
    "node-warning-context",
    "snapshot-meta",
  ]);
});

test("emits a node-model row class for the model sub-line and warns on drift", () => {
  const rowClasses = buildSnapshotRowClasses({
    nodes: [
      { id: "root", status: "running", risk: { kind: "normal" }, metrics: {}, model: { name: "claude-opus-4.7" } },
      {
        id: "drifted",
        parentId: "root",
        status: "completed",
        risk: { kind: "normal" },
        metrics: {},
        model: { name: "claude-opus-4.7" },
        metadata: { modelSwapped: true },
      },
    ],
  });

  assert.deepEqual(rowClasses, [
    "snapshot-meta",
    "snapshot-meta",
    "snapshot-meta",
    "snapshot-meta",
    "node-running",
    "node-running node-model",
    "node-completed",
    "node-completed node-model-swapped",
    "snapshot-meta",
  ]);
});

test("renders model sub-line styles in webview HTML", () => {
  const html = buildWebviewHtml({ nonce: "abc123" });

  assert.match(html, /node-model/);
  assert.match(html, /node-model-swapped/);
});

test("builds a compact status bar summary from a normalized graph", () => {
  assert.equal(
    buildStatusSummary({
      nodes: [
        { status: "running", risk: { kind: "normal" } },
        { status: "waiting", risk: { kind: "high" } },
        { status: "stale", risk: { kind: "warning" } },
      ],
    }),
    "Agents: 1 running · 1 high ctx",
  );
});
