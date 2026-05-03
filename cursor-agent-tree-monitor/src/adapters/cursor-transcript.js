import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { AgentSourceAdapter } from "./interface.js";
import { inferAgentStatus } from "../state.js";
import { extractToolAttribution } from "../tool-attribution.js";
import { TranscriptCache } from "../transcript-cache.js";

export class CursorTranscriptAdapter extends AgentSourceAdapter {
  constructor({ transcriptRoot, defaultContextLimitTokens = 1_000_000, modelContextLimits = {}, now = () => new Date(), activityWindowMs = 5 * 60 * 1000, staleWindowMs = 15 * 60 * 1000, cache = new TranscriptCache() }) {
    super();
    this.transcriptRoot = transcriptRoot;
    this.defaultContextLimitTokens = defaultContextLimitTokens;
    this.modelContextLimits = modelContextLimits;
    this.now = now;
    this.activityWindowMs = activityWindowMs;
    this.staleWindowMs = staleWindowMs;
    this.cache = cache;
  }

  async listSessions() {
    const entries = await readdir(this.transcriptRoot, { withFileTypes: true });
    const sessions = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const transcriptPath = join(this.transcriptRoot, entry.name, `${entry.name}.jsonl`);
      if (await exists(transcriptPath)) {
        const lines = await this.cache.readJsonl(transcriptPath);
        const shortId = shortSessionId(entry.name);
        sessions.push({
          id: entry.name,
          shortId,
          summary: extractRootSummary(lines, shortId),
          environment: "cursor",
          source: "cursor_transcript",
          transcriptPath,
          agentCount: await countDiscoverableAgents(this.transcriptRoot, entry.name, this.cache),
          lastActivityAt: new Date(await newestTranscriptMtimeMs(join(this.transcriptRoot, entry.name))).toISOString(),
        });
      }
    }

    return sessions.sort((a, b) => Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt));
  }

  async loadSessionGraph(sessionId) {
    const sessionDir = join(this.transcriptRoot, sessionId);
    const rootPath = join(sessionDir, `${sessionId}.jsonl`);
    const rootStats = await stat(rootPath);
    const rootLines = await this.cache.readJsonl(rootPath);

    const rootSummary = extractUserQuery(rootLines) ?? "Root orchestrator";
    const nodes = [
      transcriptNode({
        id: sessionId,
        parentId: null,
        type: "Root",
        summary: rootSummary,
        transcriptPath: rootPath,
        modifiedAt: rootStats.mtime,
        lines: rootLines,
        lineCount: rootLines.length,
        contextLimit: contextLimitForModel(extractRecordedModel(rootLines), this.modelContextLimits, this.defaultContextLimitTokens),
        now: this.now(),
        activityWindowMs: this.activityWindowMs,
        staleWindowMs: this.staleWindowMs,
      }),
    ];
    const seen = new Set([sessionId]);
    nodes.push(...(await this.collectSubagentNodes({ ownerSessionId: sessionId, parentId: sessionId, seen })));

    return {
      session: {
        id: sessionId,
        environment: "cursor",
        label: "transcript",
        refreshSeconds: 2,
        sort: "tree",
      },
      nodes,
    };
  }

  async collectSubagentNodes({ ownerSessionId, parentId, seen }) {
    const ownerDir = join(this.transcriptRoot, ownerSessionId);
    const ownerMainPath = join(ownerDir, `${ownerSessionId}.jsonl`);
    const ownerLines = (await exists(ownerMainPath)) ? await this.cache.readJsonl(ownerMainPath) : [];
    const childEntries = await loadChildEntries(this.transcriptRoot, ownerSessionId, this.cache);
    const { links: taskLinks, taskCount } = extractTaskLinks(ownerLines, childEntries);
    const relevantChildEntries = taskCount > 0 ? childEntries.filter((child) => taskLinks.has(child.id)) : childEntries;
    const nodes = [];

    for (const child of relevantChildEntries) {
      const childId = child.id;
      if (seen.has(childId)) continue;
      seen.add(childId);

      const task = taskLinks.get(childId);

      nodes.push(
        transcriptNode({
          id: childId,
          parentId,
          type: task?.type ?? "Agent",
          summary: task?.summary ?? child.query,
          transcriptPath: child.path,
          modifiedAt: child.stats.mtime,
          lines: child.lines,
          lineCount: child.lines.length,
          contextLimit: contextLimitForModel(extractRecordedModel(child.lines, task), this.modelContextLimits, this.defaultContextLimitTokens),
          now: this.now(),
          activityWindowMs: this.activityWindowMs,
          staleWindowMs: this.staleWindowMs,
          task,
        }),
      );

      nodes.push(...(await this.collectSubagentNodes({ ownerSessionId: childId, parentId: childId, seen })));
    }

    return nodes;
  }
}

function transcriptNode({ id, parentId, type, summary, transcriptPath, modifiedAt, lines, lineCount, contextLimit, now, activityWindowMs, staleWindowMs, task }) {
  const estimatedTokens = Math.max(1, lineCount) * 1_000;
  const state = inferAgentStatus({ now, modifiedAt, lines, activityWindowMs, staleWindowMs });
  const tools = extractToolAttribution(lines);
  const model = extractRecordedModel(lines, task);

  return {
    id,
    parentId,
    type,
    summary,
    status: state.status,
    model: model ? { name: model, confidence: "recorded" } : { name: null, confidence: "unknown" },
    context: {
      usedTokens: estimatedTokens,
      limitTokens: contextLimit,
      confidence: "estimated",
    },
    metrics: { inputTokens: estimatedTokens, outputTokens: 0, toolCount: tools.toolCount, errorCount: tools.errorCount },
    source: { adapter: "cursor_transcript", confidence: state.confidence },
    evidence: [
      { kind: "file", value: transcriptPath },
      ...(task ? [{ kind: "task", value: task.prompt }] : []),
    ],
    metadata: { transcriptPath, lineCount, modifiedAt: modifiedAt.toISOString(), statusHeuristic: state.reason, tools: tools.tools },
  };
}

function extractRecordedModel(lines, task) {
  if (task?.model) return task.model;

  for (const line of lines) {
    const model = line.model ?? line.modelName ?? line.model_name ?? line.message?.model ?? line.message?.modelName ?? line.message?.model_name;
    if (typeof model === "string" && model.trim()) return model.trim();
  }

  return null;
}

function extractTaskLinks(lines, childEntries = []) {
  const links = new Map();
  const unlinkedTasks = [];
  let taskCount = 0;

  for (const line of lines) {
    for (const part of line.message?.content ?? []) {
      if (part.type !== "tool_use" || !["Task", "Subagent"].includes(part.name)) continue;
      taskCount += 1;
      const input = part.input ?? {};
      const childId = input.resume;
      const task = {
        type: input.subagent_type ?? "Agent",
        summary: input.description ?? firstSentence(input.prompt) ?? childId,
        prompt: input.prompt ?? "",
        model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : null,
      };

      if (childId) links.set(childId, task);
      else unlinkedTasks.push(task);
    }
  }

  if (unlinkedTasks.length > 0) {
    const unmatchedChildren = childEntries.filter((child) => !links.has(child.id));
    const unmatchedTasks = [...unlinkedTasks];

    for (const task of [...unmatchedTasks]) {
      const bestChild = bestMatchingChild(task, unmatchedChildren);
      if (!bestChild) continue;
      links.set(bestChild.id, task);
      unmatchedChildren.splice(unmatchedChildren.indexOf(bestChild), 1);
      unmatchedTasks.splice(unmatchedTasks.indexOf(task), 1);
    }

    if (unmatchedChildren.length === unmatchedTasks.length) {
      unmatchedChildren.forEach((child, index) => {
        if (!links.has(child.id)) links.set(child.id, unmatchedTasks[index]);
      });
    }
  }

  return { links, taskCount };
}

function bestMatchingChild(task, children) {
  let best = null;
  let bestScore = 0;

  for (const child of children) {
    const score = overlapScore(task.summary, child.query);
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function overlapScore(left, right) {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  return leftTokens.filter((token) => rightTokens.includes(token)).length;
}

function meaningfulTokens(text) {
  return compact(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !["lookup", "return", "roles", "movie", "agent"].includes(token));
}

function extractUserQuery(lines) {
  for (const line of lines) {
    for (const part of line.message?.content ?? []) {
      if (part.type !== "text") continue;
      const match = part.text.match(/<user_query>([\s\S]*?)<\/user_query>/);
      if (match) return compact(match[1]);
    }
  }

  return null;
}

function extractRootSummary(lines, shortId) {
  return extractUserQuery(lines) ?? extractFirstUserText(lines) ?? `Root session ${shortId}`;
}

function extractFirstUserText(lines) {
  for (const line of lines) {
    if (line.role !== "user") continue;
    for (const part of line.message?.content ?? []) {
      if (part.type === "text" && compact(part.text ?? "")) return compact(part.text);
    }
  }

  return null;
}

async function listTranscriptFiles(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTranscriptFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function loadChildEntries(transcriptRoot, sessionId, cache) {
  const childFiles = await listTranscriptFiles(join(transcriptRoot, sessionId, "subagents"));
  const childEntries = [];

  for (const childPath of childFiles) {
    const childId = basename(childPath, ".jsonl");
    const childStats = await stat(childPath);
    const lines = await cache.readJsonl(childPath);
    childEntries.push({
      id: childId,
      path: childPath,
      stats: childStats,
      lines,
      query: extractUserQuery(lines) ?? childId,
    });
  }

  return childEntries;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function newestTranscriptMtimeMs(path) {
  const pathStats = await stat(path);
  if (!pathStats.isDirectory()) return path.endsWith(".jsonl") ? pathStats.mtimeMs : 0;

  const entries = await readdir(path, { withFileTypes: true });
  const childMtimes = await Promise.all(entries.map((entry) => newestTranscriptMtimeMs(join(path, entry.name))));
  return Math.max(0, ...childMtimes);
}

async function countDiscoverableAgents(transcriptRoot, sessionId, cache, seen = new Set()) {
  if (seen.has(sessionId)) return 0;
  seen.add(sessionId);

  const ownerMainPath = join(transcriptRoot, sessionId, `${sessionId}.jsonl`);
  const ownerLines = (await exists(ownerMainPath)) ? await cache.readJsonl(ownerMainPath) : [];
  const childEntries = await loadChildEntries(transcriptRoot, sessionId, cache);
  const { links: taskLinks, taskCount } = extractTaskLinks(ownerLines, childEntries);
  const relevantChildEntries = taskCount > 0 ? childEntries.filter((child) => taskLinks.has(child.id)) : childEntries;
  let count = 1;

  for (const child of relevantChildEntries) {
    count += await countDiscoverableAgents(transcriptRoot, child.id, cache, seen);
  }

  return count;
}

function shortSessionId(id) {
  return id.slice(0, 8);
}

function contextLimitForModel(model, modelContextLimits, defaultLimit) {
  return model && Number.isFinite(modelContextLimits[model]) ? modelContextLimits[model] : defaultLimit;
}

function firstSentence(text) {
  return compact(text ?? "").split(/[.!?]/)[0] || null;
}

function compact(text) {
  return text.replace(/\s+/g, " ").trim();
}
