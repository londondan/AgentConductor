#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";

import { CursorTranscriptAdapter } from "./adapters/cursor-transcript.js";
import { normalizeSessionGraph } from "./core.js";
import { renderAsciiTree } from "./ascii-renderer.js";
import { createLiveMonitor } from "./live-monitor.js";

const DEFAULT_MODEL_TELEMETRY_PATH = join(homedir(), ".cursor", "agent-tree-monitor", "model-events.jsonl");

export function parseCliArgs(args) {
  const options = {
    adapter: "cursor-transcript",
    root: null,
    session: "latest",
    refreshSeconds: 2,
    unicode: true,
    once: false,
    modelTelemetryPath: process.env.AGENT_TREE_MODEL_EVENTS || DEFAULT_MODEL_TELEMETRY_PATH,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--adapter") options.adapter = args[++index];
    else if (arg === "--root") options.root = args[++index];
    else if (arg === "--session") options.session = args[++index];
    else if (arg === "--refresh") options.refreshSeconds = Number(args[++index]);
    else if (arg === "--ascii") options.unicode = false;
    else if (arg === "--once") options.once = true;
    else if (arg === "--model-telemetry") options.modelTelemetryPath = args[++index];
    else if (arg === "--no-model-telemetry") options.modelTelemetryPath = null;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export async function runCli(args = process.argv.slice(2), io = process) {
  const options = parseCliArgs(args);
  if (options.help || !options.root) {
    io.stdout.write(helpText());
    return 0;
  }

  const adapter = createAdapter(options);
  const sessionId = await resolveSessionId(adapter, options.session);

  if (options.once) {
    const graph = normalizeSessionGraph(await adapter.loadSessionGraph(sessionId));
    io.stdout.write(`${renderAsciiTree(graph, { unicode: options.unicode })}\n`);
    return 0;
  }

  const monitor = createLiveMonitor({
    adapter,
    sessionId,
    refreshSeconds: options.refreshSeconds,
    render: (graph) => renderAsciiTree(graph, { unicode: options.unicode }),
    write: (snapshot) => io.stdout.write(`\x1Bc${snapshot}\n`),
  });

  await monitor.start();
  return 0;
}

function createAdapter(options) {
  if (options.adapter === "cursor-transcript") {
    return new CursorTranscriptAdapter({
      transcriptRoot: options.root,
      modelTelemetryPath: options.modelTelemetryPath,
    });
  }

  throw new Error(`Unsupported adapter: ${options.adapter}`);
}

async function resolveSessionId(adapter, requestedSessionId) {
  if (requestedSessionId !== "latest") return requestedSessionId;
  const sessions = await adapter.listSessions();
  if (sessions.length === 0) throw new Error("No sessions found");
  return sessions.at(-1).id;
}

function helpText() {
  return `Usage: agent-tree-monitor --root <transcript-root> [options]

Options:
  --adapter cursor-transcript   Source adapter to use
  --session <id|latest>         Session to monitor
  --refresh <seconds>           Refresh interval, defaults to 2
  --ascii                       Use ASCII-safe output
  --once                        Render one snapshot and exit
  --model-telemetry <path>      Override the hook telemetry jsonl
                                (defaults to AGENT_TREE_MODEL_EVENTS or
                                ~/.cursor/agent-tree-monitor/model-events.jsonl)
  --no-model-telemetry          Disable hook telemetry merging
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
