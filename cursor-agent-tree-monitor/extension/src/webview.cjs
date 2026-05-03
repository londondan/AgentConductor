function buildWebviewHtml({ nonce }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Tree Monitor</title>
  <style>
    body {
      margin: 0;
      padding: 12px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    h1 {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }
    button {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 2px;
      padding: 4px 8px;
      cursor: pointer;
    }
    .meta {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin-bottom: 10px;
    }
    pre {
      overflow: auto;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      font-family: var(--vscode-editor-font-family), monospace;
      font-size: 12px;
      line-height: 1.35;
      white-space: pre;
    }
    .snapshot-line {
      display: block;
      min-height: 1.35em;
    }
    .snapshot-meta {
      color: var(--vscode-descriptionForeground);
    }
    .node-running {
      color: var(--vscode-testing-iconPassed);
    }
    .node-completed {
      color: var(--vscode-disabledForeground);
    }
    .node-high-context,
    .node-failed {
      color: var(--vscode-testing-iconFailed);
    }
    .node-warning-context {
      color: var(--vscode-testing-iconQueued);
    }
    .node-muted,
    .node-tools {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <header>
    <h1>Agent Tree Monitor</h1>
    <button id="select-session">Select Session</button>
  </header>
  <div class="meta" id="attached">attached: waiting for snapshot</div>
  <pre id="snapshot">Loading...</pre>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    document.getElementById('select-session').addEventListener('click', () => {
      vscode.postMessage({ type: 'selectSession' });
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'snapshot') {
        document.getElementById('attached').textContent = 'attached: ' + message.attached + ' · ' + message.sessionId;
        renderSnapshot(message);
      }
      if (message.type === 'error') {
        document.getElementById('attached').textContent = 'error';
        document.getElementById('snapshot').textContent = message.message;
      }
    });
    function renderSnapshot(message) {
      const snapshot = document.getElementById('snapshot');
      const lines = String(message.text || '').split('\\n');
      const rowClasses = Array.isArray(message.rowClasses) ? message.rowClasses : [];
      if (rowClasses.length === 0) {
        snapshot.textContent = message.text;
        return;
      }

      snapshot.replaceChildren(...lines.map((line, index) => {
        const span = document.createElement('span');
        span.className = 'snapshot-line ' + (rowClasses[index] || 'snapshot-meta');
        span.textContent = line;
        return span;
      }));
    }
  </script>
</body>
</html>`;
}

function buildSessionItems(sessions, options = {}) {
  return [...sessions]
    .sort((a, b) => Date.parse(b.lastActivityAt ?? 0) - Date.parse(a.lastActivityAt ?? 0))
    .map((session) => ({
      label: truncate(session.summary ?? `Root session ${shortSessionId(session.id)}`, 70),
      description: buildSessionDescription(session, options),
      detail: session.transcriptPath ?? session.id,
      sessionId: session.id,
    }));
}

function buildSessionDescription(session, options) {
  return [
    formatLastActive(session.lastActivityAt, options),
    formatAgentCount(session.agentCount),
    session.shortId ?? shortSessionId(session.id),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatLastActive(value, { now = new Date(), locale = undefined, timeZone = undefined } = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Last active unknown";

  const sameLocalDay = dateParts(date, timeZone).date === dateParts(now, timeZone).date;
  const formatter = new Intl.DateTimeFormat(locale, {
    ...(sameLocalDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

  return `Last active ${formatter.format(date)}`;
}

function formatAgentCount(agentCount) {
  if (!Number.isFinite(agentCount)) return null;
  return `${agentCount} ${agentCount === 1 ? "agent" : "agents"}`;
}

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  return {
    date: `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`,
  };
}

function part(parts, type) {
  return parts.find((entry) => entry.type === type)?.value;
}

function truncate(value, maxLength) {
  const string = String(value);
  if (string.length <= maxLength) return string;
  return `${string.slice(0, maxLength - 1)}…`;
}

function shortSessionId(id) {
  return String(id).slice(0, 8);
}

async function createMonitorSnapshot({ adapter, sessionId, render, normalize }) {
  const resolvedSessionId = sessionId === "latest" ? await resolveLatestSessionId(adapter) : sessionId;
  const rawGraph = await adapter.loadSessionGraph(resolvedSessionId);
  const graph = normalize ? normalize(rawGraph) : rawGraph;

  const text = render(graph);
  return {
    type: "snapshot",
    attached: sessionId === "latest" ? "latest active transcript" : "selected transcript",
    sessionId: resolvedSessionId,
    status: buildStatusSummary(graph),
    text,
    rowClasses: alignRowClasses(text, buildSnapshotRowClasses(graph)),
  };
}

function alignRowClasses(text, rowClasses) {
  const lineCount = String(text ?? "").split("\n").length;
  return Array.from({ length: lineCount }, (_, index) => rowClasses[index] ?? "snapshot-meta");
}

function buildSnapshotRowClasses(graph) {
  const rowClasses = ["snapshot-meta", "snapshot-meta", "snapshot-meta", "snapshot-meta"];
  const roots = getRoots(graph);

  for (const root of roots) {
    appendNodeRowClasses(root, rowClasses);
  }

  rowClasses.push("snapshot-meta");
  return rowClasses;
}

function appendNodeRowClasses(node, rowClasses) {
  const nodeClass = nodeRowClass(node);
  rowClasses.push(nodeClass);
  if (node.metrics?.toolCount) rowClasses.push(`${nodeClass} node-tools`);

  for (const child of node.children ?? []) {
    appendNodeRowClasses(child, rowClasses);
  }
}

function nodeRowClass(node) {
  if (node.risk?.kind === "high") return "node-high-context";
  if (node.status === "failed") return "node-failed";
  if (node.risk?.kind === "warning") return "node-warning-context";
  if (node.status === "running") return "node-running";
  if (node.status === "completed") return "node-completed";
  return "node-muted";
}

function getRoots(graph) {
  if (Array.isArray(graph.roots)) return graph.roots;

  const nodesById = new Map((graph.nodes ?? []).map((node) => [node.id, { ...node, children: [] }]));
  for (const node of nodesById.values()) {
    if (!node.parentId) continue;
    nodesById.get(node.parentId)?.children.push(node);
  }

  return [...nodesById.values()].filter((node) => !node.parentId || !nodesById.has(node.parentId));
}

function buildStatusSummary(graph) {
  const nodes = graph.nodes ?? [];
  const running = nodes.filter((node) => node.status === "running").length;
  const highContext = nodes.filter((node) => node.risk?.kind === "high").length;
  return `Agents: ${running} running · ${highContext} high ctx`;
}

async function resolveLatestSessionId(adapter) {
  const sessions = await adapter.listSessions();
  if (sessions.length === 0) throw new Error("No Cursor agent transcript sessions found");
  return sessions.at(-1).id;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[char];
  });
}

module.exports = {
  buildSnapshotRowClasses,
  buildSessionItems,
  buildStatusSummary,
  buildWebviewHtml,
  createMonitorSnapshot,
  resolveLatestSessionId,
};
