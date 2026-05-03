export class AgentSourceAdapter {
  async listSessions() {
    throw new Error("AgentSourceAdapter.listSessions must be implemented");
  }

  async loadSessionGraph() {
    throw new Error("AgentSourceAdapter.loadSessionGraph must be implemented");
  }

  async getNodeEvidence() {
    return [];
  }

  watchOrPoll({ refreshSeconds = 2, onSnapshot }) {
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      await onSnapshot();
      if (!stopped) setTimeout(tick, refreshSeconds * 1000);
    };

    void tick();

    return {
      stop() {
        stopped = true;
      },
    };
  }
}
