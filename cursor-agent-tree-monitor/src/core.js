const VALID_STATUSES = new Set(["pending", "running", "waiting", "stale", "completed", "failed", "cancelled", "unknown"]);

export function calculateContextRisk(context) {
  if (!context || !Number.isFinite(context.usedTokens) || !Number.isFinite(context.limitTokens) || context.limitTokens <= 0) {
    return { kind: "unknown", percent: null, confidence: "unknown" };
  }

  const percent = Number(((context.usedTokens / context.limitTokens) * 100).toFixed(1));
  const kind = percent >= 90 ? "high" : percent >= 75 ? "warning" : "normal";

  return {
    kind,
    percent,
    confidence: context.confidence ?? "estimated",
  };
}

export function normalizeSessionGraph(input) {
  const session = normalizeSession(input.session);
  const nodes = (input.nodes ?? []).map(normalizeNode);
  const nodesById = new Map(nodes.map((node) => [node.id, { ...node, children: [] }]));

  for (const node of nodesById.values()) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (parent) parent.children.push(node);
  }

  const roots = [...nodesById.values()].filter((node) => !node.parentId || !nodesById.has(node.parentId));

  return {
    session,
    nodes: [...nodesById.values()],
    roots,
    edges: [...nodesById.values()]
      .filter((node) => node.parentId && nodesById.has(node.parentId))
      .map((node) => ({ parentId: node.parentId, childId: node.id })),
    nodesById,
  };
}

function normalizeSession(session = {}) {
  return {
    id: String(session.id ?? "unknown"),
    environment: session.environment ?? "unknown",
    label: session.label ?? null,
    startedAt: session.startedAt ?? null,
    now: session.now ?? new Date().toISOString(),
    refreshSeconds: session.refreshSeconds ?? 2,
    sort: session.sort ?? "tree",
    metadata: session.metadata ?? {},
  };
}

function normalizeNode(node) {
  const context = node.context ?? null;

  return {
    id: String(node.id),
    parentId: node.parentId ? String(node.parentId) : null,
    type: node.type ?? "Agent",
    summary: node.summary ?? "",
    status: VALID_STATUSES.has(node.status) ? node.status : "unknown",
    model: node.model ?? { name: null, confidence: "unknown" },
    context,
    risk: calculateContextRisk(context),
    metrics: {
      inputTokens: node.metrics?.inputTokens ?? 0,
      outputTokens: node.metrics?.outputTokens ?? 0,
      toolCount: node.metrics?.toolCount ?? 0,
      errorCount: node.metrics?.errorCount ?? 0,
    },
    source: node.source ?? { adapter: "unknown", confidence: "unknown" },
    evidence: node.evidence ?? [],
    metadata: node.metadata ?? {},
  };
}
