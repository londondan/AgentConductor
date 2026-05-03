export class CursorSdkTelemetryRecorder {
  constructor({ sessionId, environment = "cursor", label = null, contextLimitTokens = 1_000_000 }) {
    this.session = {
      id: sessionId,
      environment,
      label,
      refreshSeconds: 2,
      sort: "tree",
      startedAt: new Date().toISOString(),
    };
    this.contextLimitTokens = contextLimitTokens;
    this.nodes = new Map();
  }

  recordRunStarted({ agentId, runId, parentAgentId = null, type = "Agent", summary = "", model = null }) {
    const existing = this.nodes.get(agentId) ?? {};

    this.nodes.set(agentId, {
      ...existing,
      id: agentId,
      parentId: parentAgentId,
      type,
      summary,
      status: "running",
      model: { name: model, confidence: model ? "recorded" : "unknown" },
      context: existing.context ?? {
        usedTokens: 0,
        limitTokens: this.contextLimitTokens,
        confidence: "recorded",
      },
      metrics: existing.metrics ?? { inputTokens: 0, outputTokens: 0 },
      source: { adapter: "cursor_sdk", confidence: "recorded" },
      evidence: [{ kind: "run", value: runId }],
      metadata: { ...(existing.metadata ?? {}), runId },
    });
  }

  recordTokenUsage({ agentId, inputTokens = 0, outputTokens = 0, contextTokens = null }) {
    const existing = this.nodes.get(agentId);
    if (!existing) throw new Error(`Cannot record token usage for unknown agent: ${agentId}`);

    this.nodes.set(agentId, {
      ...existing,
      context: {
        usedTokens: contextTokens ?? inputTokens + outputTokens,
        limitTokens: this.contextLimitTokens,
        confidence: "recorded",
      },
      metrics: { inputTokens, outputTokens },
    });
  }

  recordRunFinished({ agentId, status = "completed" }) {
    const existing = this.nodes.get(agentId);
    if (!existing) throw new Error(`Cannot finish unknown agent: ${agentId}`);
    this.nodes.set(agentId, { ...existing, status });
  }

  toSessionGraph() {
    return {
      session: { ...this.session, now: new Date().toISOString() },
      nodes: [...this.nodes.values()],
    };
  }
}
