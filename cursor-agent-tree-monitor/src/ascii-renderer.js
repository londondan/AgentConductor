const DEFAULT_WIDTH = 72;

export function renderAsciiTree(graph, options = {}) {
  const width = options.width ?? DEFAULT_WIDTH;
  const glyphs = options.unicode === false ? ASCII_GLYPHS : UNICODE_GLYPHS;
  const innerWidth = Math.max(20, width - 2);
  const lines = [];

  lines.push(frameLine(headerLine(graph), innerWidth, glyphs));
  lines.push(frameLine(summaryLine(graph, glyphs), innerWidth, glyphs));
  lines.push(frameLine(`sort: ${graph.session.sort ?? "tree"}`, innerWidth, glyphs));
  lines.push(separator(innerWidth, glyphs));

  for (const root of graph.roots) {
    renderNode(root, "", true, lines, innerWidth, glyphs);
  }

  lines.push(bottom(innerWidth, glyphs));
  return lines.join("\n");
}

function renderNode(node, prefix, isRoot, lines, innerWidth, glyphs) {
  const status = statusGlyph(node.status, glyphs);
  const connector = isRoot ? "" : `${glyphs.last} `;
  const label = `${prefix}${connector}${formatNodeLabel(node, status, isRoot)}`;
  const percent = node.risk.percent === null ? "??.?%" : `${node.risk.percent.toFixed(1)}%`;
  const bar = contextBar(node.risk.percent);
  const metric = `${percent.padStart(6)}  ${bar}`;
  const availableLabelWidth = Math.max(1, innerWidth - metric.length - 4);
  lines.push(frameLine(`${truncate(label, availableLabelWidth).padEnd(availableLabelWidth)}  ${metric}`, innerWidth, glyphs));
  if (node.metrics?.toolCount) {
    lines.push(frameLine(`${prefix}${isRoot ? "" : "  "}tools ${node.metrics.toolCount}${node.metrics.errorCount ? ` · err ${node.metrics.errorCount}` : ""}`, innerWidth, glyphs));
  }

  const childPrefix = `${prefix}${isRoot ? "" : "  "}`;
  for (const child of node.children) {
    renderNode(child, childPrefix, false, lines, innerWidth, glyphs);
  }
}

function formatNodeLabel(node, status, isRoot) {
  const model = node.model?.name ? ` [${node.model.name}]` : "";
  if (isRoot) {
    return `${status} ${node.type}${model}`;
  }

  const summary = node.summary ? ` "${node.summary}"` : "";
  return `${status} [${node.type}]${model}${summary}`;
}

function headerLine(graph) {
  const parts = [`Session ${graph.session.id}`, graph.session.environment];
  if (graph.session.label) parts.push(graph.session.label);
  parts.push(`elapsed ${formatElapsed(graph.session.startedAt, graph.session.now)}`);
  parts.push(`refresh ${graph.session.refreshSeconds ?? 2}s`);
  return parts.join(" · ");
}

function summaryLine(graph, glyphs) {
  const nodeCount = graph.nodes.length;
  const runningCount = graph.nodes.filter((node) => node.status === "running").length;
  const highContextCount = graph.nodes.filter((node) => node.risk.kind === "high").length;
  const inputTokens = graph.nodes.reduce((sum, node) => sum + (node.metrics.inputTokens ?? 0), 0);
  const outputTokens = graph.nodes.reduce((sum, node) => sum + (node.metrics.outputTokens ?? 0), 0);

  return `${nodeCount} agents · ${runningCount} running ${glyphs.running} · in ${formatTokens(inputTokens)} out ${formatTokens(outputTokens)} · ! ${highContextCount} high context`;
}

function formatElapsed(startedAt, now) {
  if (!startedAt) return "unknown";
  const start = Date.parse(startedAt);
  const end = Date.parse(now ?? new Date().toISOString());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "unknown";

  const totalMinutes = Math.floor((end - start) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h${minutes.toString().padStart(2, "0")}m` : `${minutes}m`;
}

function formatTokens(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function contextBar(percent) {
  if (percent === null) return "-----";
  const filled = Math.max(0, Math.min(5, Math.round(percent / 20)));
  return `${"#".repeat(filled)}${"-".repeat(5 - filled)}`;
}

function statusGlyph(status, glyphs) {
  if (status === "running") return glyphs.running;
  if (status === "waiting") return glyphs.waiting;
  if (status === "stale") return glyphs.stale;
  if (status === "completed") return glyphs.completed;
  if (status === "failed") return "x";
  if (status === "cancelled") return "-";
  return "?";
}

function frameLine(content, innerWidth, glyphs) {
  return `${glyphs.vertical} ${truncate(content, innerWidth - 2).padEnd(innerWidth - 2)} ${glyphs.vertical}`;
}

function separator(innerWidth, glyphs) {
  return `${glyphs.branch}${glyphs.horizontal.repeat(innerWidth)}${glyphs.right}`;
}

function bottom(innerWidth, glyphs) {
  return `${glyphs.bottomLeft}${glyphs.horizontal.repeat(innerWidth)}${glyphs.bottomRight}`;
}

function truncate(value, width) {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

const UNICODE_GLYPHS = {
  vertical: "│",
  horizontal: "─",
  branch: "├",
  right: "┤",
  bottomLeft: "└",
  bottomRight: "┘",
  last: "└─",
  running: "▶",
  waiting: "…",
  stale: "!",
  completed: "✓",
};

const ASCII_GLYPHS = {
  vertical: "|",
  horizontal: "-",
  branch: "|",
  right: "|",
  bottomLeft: "`",
  bottomRight: "'",
  last: "`--",
  running: ">",
  waiting: "...",
  stale: "!",
  completed: "done",
};
