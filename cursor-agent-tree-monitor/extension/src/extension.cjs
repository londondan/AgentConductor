const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { resolveTranscriptRoot } = require("./session.cjs");
const { buildSessionItems, buildStatusSummary, buildWebviewHtml, createMonitorSnapshot } = require("./webview.cjs");

let statusBarItem;
let latestStatus = "Agents: 0 running · 0 high ctx";

async function activate(context) {
  const vscode = require("vscode");
  const provider = new AgentTreeMonitorViewProvider(context, vscode);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("agentTreeMonitor.view", provider, {
    webviewOptions: { retainContextWhenHidden: true },
  }));

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "agentTreeMonitor.open";
  statusBarItem.tooltip = "Open Agent Tree Monitor";
  updateStatusBar();
  context.subscriptions.push(statusBarItem);

  const disposable = vscode.commands.registerCommand("agentTreeMonitor.open", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.agentTreeMonitor");
    provider.refresh();
  });
  context.subscriptions.push(disposable);
}

function deactivate() {
  statusBarItem?.dispose();
}

class AgentTreeMonitorViewProvider {
  constructor(context, vscode) {
    this.context = context;
    this.vscode = vscode;
    this.controller = null;
  }

  async resolveWebviewView(view) {
    this.controller = await createPanelController({ context: this.context, vscode: this.vscode, panel: view });
    this.controller.start();
  }

  refresh() {
    this.controller?.refresh();
  }
}

async function openMonitor(context, vscode) {
  const panel = vscode.window.createWebviewPanel(
    "agentTreeMonitor",
    "Agent Tree Monitor",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const controller = await createPanelController({ context, vscode, panel });
  controller.start();
}

async function createPanelController({ context, vscode, panel }) {
  const modules = await loadMonitorCore();
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const config = vscode.workspace.getConfiguration("agentTreeMonitor");
  const explicitRoot = config.get("transcriptRoot") || process.env.AGENT_TREE_TRANSCRIPT_ROOT || "";
  const refreshSeconds = Number(config.get("refreshSeconds") || 2);
  const modelContextLimits = config.get("modelContextLimits") || {};
  const modelTelemetryPath = config.get("modelTelemetryPath") || process.env.AGENT_TREE_MODEL_EVENTS || path.join(os.homedir(), ".cursor", "agent-tree-monitor", "model-events.jsonl");
  const transcriptRoot = resolveTranscriptRoot({
    explicitRoot,
    homeDir: os.homedir(),
    workspacePath,
  });
  const adapter = new modules.CursorTranscriptAdapter({ transcriptRoot, modelContextLimits, modelTelemetryPath });
  let selectedSessionId = "latest";
  let interval = null;
  let disposed = false;

  panel.webview.options = { ...(panel.webview.options ?? {}), enableScripts: true };
  panel.webview.html = buildWebviewHtml({ nonce: createNonce() });
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "selectSession") {
      const picked = await pickSession({ adapter, vscode });
      if (picked) {
        selectedSessionId = picked;
        await refresh();
      }
    }
  }, null, context.subscriptions);

  panel.onDidDispose(() => {
    disposed = true;
    if (interval) clearInterval(interval);
  }, null, context.subscriptions);

  async function refresh() {
    if (disposed) return;
    try {
      const payload = await createMonitorSnapshot({
        adapter,
        sessionId: selectedSessionId,
        normalize: modules.normalizeSessionGraph,
        render: (graph) => modules.renderAsciiTree(graph, { unicode: true }),
      });
      latestStatus = payload.status ?? buildStatusSummary({ nodes: [] });
      updateStatusBar();
      panel.webview.postMessage(payload);
    } catch (error) {
      panel.webview.postMessage({ type: "error", message: error.message });
    }
  }

  return {
    start() {
      void refresh();
      interval = setInterval(refresh, refreshSeconds * 1000);
    },
    refresh,
  };
}

function updateStatusBar() {
  if (!statusBarItem) return;
  statusBarItem.text = `$(pulse) ${latestStatus}`;
  statusBarItem.show();
}

async function pickSession({ adapter, vscode }) {
  const items = buildSessionItems(await adapter.listSessions());
  const picked = await vscode.window.showQuickPick(items, {
    title: "Attach Agent Tree Monitor",
    placeHolder: "Choose a Cursor transcript session",
  });
  return picked?.sessionId ?? null;
}

async function loadMonitorCore() {
  const root = path.resolve(__dirname, "..", "..");
  const [adapterModule, coreModule, rendererModule] = await Promise.all([
    import(pathToFileURL(path.join(root, "src", "adapters", "cursor-transcript.js")).href),
    import(pathToFileURL(path.join(root, "src", "core.js")).href),
    import(pathToFileURL(path.join(root, "src", "ascii-renderer.js")).href),
  ]);

  return {
    CursorTranscriptAdapter: adapterModule.CursorTranscriptAdapter,
    normalizeSessionGraph: coreModule.normalizeSessionGraph,
    renderAsciiTree: rendererModule.renderAsciiTree,
  };
}

function createNonce() {
  return Math.random().toString(36).slice(2);
}

module.exports = {
  activate,
  AgentTreeMonitorViewProvider,
  createPanelController,
  deactivate,
  openMonitor,
};
