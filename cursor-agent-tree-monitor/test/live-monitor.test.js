import test from "node:test";
import assert from "node:assert/strict";

import { createLiveMonitor } from "../src/live-monitor.js";

test("polls an adapter and renders snapshots at the configured interval", async () => {
  const rendered = [];
  const scheduled = [];
  const adapter = {
    async loadSessionGraph() {
      return {
        session: { id: "s1", environment: "fixture", refreshSeconds: 2 },
        nodes: [
          {
            id: "root",
            type: "Root",
            summary: "Do work",
            status: "running",
            context: { usedTokens: 100, limitTokens: 1_000, confidence: "recorded" },
            source: { adapter: "fixture", confidence: "recorded" },
          },
        ],
      };
    },
  };

  const monitor = createLiveMonitor({
    adapter,
    sessionId: "s1",
    refreshSeconds: 2,
    render: () => "snapshot",
    write: (snapshot) => rendered.push(snapshot),
    setTimeoutFn: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeoutFn: () => {},
  });

  await monitor.start();

  assert.deepEqual(rendered, ["snapshot"]);
  assert.equal(scheduled[0].delay, 2_000);

  monitor.stop();
});
