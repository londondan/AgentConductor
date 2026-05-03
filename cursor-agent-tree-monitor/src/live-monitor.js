import { normalizeSessionGraph } from "./core.js";
import { renderAsciiTree } from "./ascii-renderer.js";

export function createLiveMonitor({
  adapter,
  sessionId,
  refreshSeconds = 2,
  render = renderAsciiTree,
  write = (snapshot) => process.stdout.write(`\x1Bc${snapshot}\n`),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let stopped = false;
  let timer = null;

  async function tick() {
    const rawGraph = await adapter.loadSessionGraph(sessionId);
    const graph = normalizeSessionGraph({
      ...rawGraph,
      session: { ...rawGraph.session, refreshSeconds },
    });
    write(render(graph));

    if (!stopped) {
      timer = setTimeoutFn(tick, refreshSeconds * 1000);
    }
  }

  return {
    async start() {
      stopped = false;
      await tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeoutFn(timer);
    },
  };
}
