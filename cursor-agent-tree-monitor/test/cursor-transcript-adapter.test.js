import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CursorTranscriptAdapter } from "../src/adapters/cursor-transcript.js";

test("loads a Cursor transcript tree from nested JSONL files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const sessionId = "117990af";
  const childId = "child-1";
  const sessionDir = join(rootDir, sessionId);
  await mkdir(join(sessionDir, "subagents"), { recursive: true });

  await writeFile(
    join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "<user_query>Build auth monitor</user_query>" }] },
      }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Task",
              input: {
                description: "Explore auth tests",
                subagent_type: "explore",
                resume: childId,
                prompt: "Search for existing auth test patterns.",
              },
            },
          ],
        },
      }),
    ].join("\n"),
  );

  await writeFile(
    join(sessionDir, "subagents", `${childId}.jsonl`),
    JSON.stringify({
      role: "assistant",
      message: { content: [{ type: "text", text: "Found auth tests." }] },
    }),
  );

  const adapter = new CursorTranscriptAdapter({ transcriptRoot: rootDir, defaultContextLimitTokens: 1_000_000 });
  const sessions = await adapter.listSessions();
  const graph = await adapter.loadSessionGraph(sessionId);

  assert.deepEqual(sessions.map((session) => session.id), [sessionId]);
  assert.equal(graph.session.environment, "cursor");
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes[0].summary, "Build auth monitor");
  assert.equal(graph.nodes[1].parentId, sessionId);
  assert.equal(graph.nodes[1].type, "explore");
  assert.equal(graph.nodes[1].summary, "Explore auth tests");
  assert.equal(graph.nodes[1].model?.confidence, "unknown");
  assert.equal(graph.nodes[1].context.confidence, "estimated");
});

test("orders latest sessions by transcript activity and infers running status from recent writes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const oldSessionId = "zzzz-old";
  const activeSessionId = "aaaa-active";
  const oldDir = join(rootDir, oldSessionId);
  const activeDir = join(rootDir, activeSessionId);
  await mkdir(oldDir, { recursive: true });
  await mkdir(activeDir, { recursive: true });

  const oldPath = join(oldDir, `${oldSessionId}.jsonl`);
  const activePath = join(activeDir, `${activeSessionId}.jsonl`);
  await writeFile(oldPath, JSON.stringify({ role: "user", message: { content: [] } }));
  await writeFile(activePath, JSON.stringify({ role: "user", message: { content: [] } }));

  const now = new Date("2026-05-02T22:40:00.000Z");
  await utimes(oldPath, new Date("2026-05-02T20:00:00.000Z"), new Date("2026-05-02T20:00:00.000Z"));
  await utimes(activePath, now, now);

  const adapter = new CursorTranscriptAdapter({
    transcriptRoot: rootDir,
    now: () => now,
    activityWindowMs: 5 * 60 * 1000,
  });
  const sessions = await adapter.listSessions();
  const graph = await adapter.loadSessionGraph(activeSessionId);

  assert.equal(sessions.at(-1).id, activeSessionId);
  assert.equal(graph.nodes[0].status, "running");
  assert.equal(graph.nodes[0].source.confidence, "inferred");
});

test("uses explicitly recorded model metadata for node labels and context limits", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const sessionId = "model-root";
  const childId = "model-child";
  const sessionDir = join(rootDir, sessionId);
  await mkdir(join(sessionDir, "subagents"), { recursive: true });

  await writeFile(
    join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({ role: "user", model: "gpt-5.5-medium", message: { content: [{ type: "text", text: "<user_query>Monitor models</user_query>" }] } }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Subagent",
              input: { resume: childId, description: "Check child model", subagent_type: "generalPurpose", model: "composer-2-fast" },
            },
          ],
        },
      }),
    ].join("\n"),
  );
  await writeFile(
    join(sessionDir, "subagents", `${childId}.jsonl`),
    JSON.stringify({ role: "assistant", message: { model: "composer-2-fast", content: [{ type: "text", text: "Child work." }] } }),
  );

  const adapter = new CursorTranscriptAdapter({
    transcriptRoot: rootDir,
    defaultContextLimitTokens: 1_000_000,
    modelContextLimits: {
      "gpt-5.5-medium": 400_000,
      "composer-2-fast": 200_000,
    },
  });
  const graph = await adapter.loadSessionGraph(sessionId);
  const child = graph.nodes.find((node) => node.id === childId);

  assert.deepEqual(graph.nodes[0].model, { name: "gpt-5.5-medium", confidence: "recorded" });
  assert.equal(graph.nodes[0].context.limitTokens, 400_000);
  assert.deepEqual(child.model, { name: "composer-2-fast", confidence: "recorded" });
  assert.equal(child.context.limitTokens, 200_000);
});

test("uses hook telemetry model data for root and subagent nodes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const telemetryPath = join(rootDir, "model-events.jsonl");
  const sessionId = "hook-root";
  const childId = "hook-child";
  const toolUseId = "toolu_child_model";
  const sessionDir = join(rootDir, sessionId);
  await mkdir(join(sessionDir, "subagents"), { recursive: true });

  await writeFile(
    telemetryPath,
    [
      JSON.stringify({ event: "sessionStart", conversationId: sessionId, sessionId, model: "gpt-5.5-medium" }),
      JSON.stringify({ event: "subagentStop", parentConversationId: sessionId, subagentId: toolUseId, model: "claude-sonnet-4.6" }),
    ].join("\n"),
  );
  await writeFile(
    join(sessionDir, `${sessionId}.jsonl`),
    [
      jsonlUser("Monitor hook models"),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "Subagent",
              input: { resume: childId, description: "Check hook child model", subagent_type: "generalPurpose" },
            },
          ],
        },
      }),
    ].join("\n"),
  );
  await writeFile(join(sessionDir, "subagents", `${childId}.jsonl`), jsonlUser("Child work without model in transcript"));

  const adapter = new CursorTranscriptAdapter({
    transcriptRoot: rootDir,
    modelTelemetryPath: telemetryPath,
    modelContextLimits: {
      "gpt-5.5-medium": 400_000,
      "claude-sonnet-4.6": 200_000,
    },
  });
  const graph = await adapter.loadSessionGraph(sessionId);
  const child = graph.nodes.find((node) => node.id === childId);

  assert.deepEqual(graph.nodes[0].model, { name: "gpt-5.5-medium", confidence: "recorded" });
  assert.equal(graph.nodes[0].context.limitTokens, 400_000);
  assert.deepEqual(child.model, { name: "claude-sonnet-4.6", confidence: "recorded" });
  assert.equal(child.context.limitTokens, 200_000);
  assert.equal(child.metadata.modelSource, "cursor_hook_telemetry");
});

test("filters stale unlinked child transcripts when parent has explicit subagent calls", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const sessionId = "root-session";
  const currentMovieId = "current-movie";
  const staleMovieId = "stale-movie";
  const currentLinearId = "current-linear";
  const staleLinearId = "stale-linear";
  const sessionDir = join(rootDir, sessionId);
  await mkdir(join(sessionDir, "subagents"), { recursive: true });

  await writeFile(
    join(sessionDir, `${sessionId}.jsonl`),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Subagent", input: { description: "Coordinate random movies", subagent_type: "generalPurpose" } },
          { type: "tool_use", name: "Subagent", input: { description: "Check IA-44 Linear issues", subagent_type: "generalPurpose" } },
        ],
      },
    }),
  );
  await writeFile(join(sessionDir, "subagents", `${currentMovieId}.jsonl`), jsonlUser("Choose three random movies and launch movie subagents"));
  await writeFile(join(sessionDir, "subagents", `${staleMovieId}.jsonl`), jsonlUser("You are coordinating a small delegation task for well-known movies"));
  await writeFile(join(sessionDir, "subagents", `${currentLinearId}.jsonl`), jsonlUser("Check Linear for open IA-44 issues"));
  await writeFile(join(sessionDir, "subagents", `${staleLinearId}.jsonl`), jsonlUser("Check Linear for any open issues assigned to Dan James"));

  const adapter = new CursorTranscriptAdapter({ transcriptRoot: rootDir });
  const sessions = await adapter.listSessions();
  const graph = await adapter.loadSessionGraph(sessionId);

  assert.equal(sessions.find((session) => session.id === sessionId).agentCount, 3);
  assert.deepEqual(
    graph.nodes.map((node) => node.id).sort(),
    [currentLinearId, currentMovieId, sessionId].sort(),
  );
});

test("lists sessions with readable summary, short id, agent count, and transcript path", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const sessionId = "d546a303-a1b8-40f9-af83-7728252f46d1";
  const sessionDir = join(rootDir, sessionId);
  await mkdir(join(sessionDir, "subagents"), { recursive: true });
  await writeFile(
    join(sessionDir, `${sessionId}.jsonl`),
    jsonlUser("can you please create a subagent whose job it is to choose three random movies"),
  );
  await writeFile(join(sessionDir, "subagents", "child-one.jsonl"), jsonlUser("Child one"));
  await writeFile(join(sessionDir, "subagents", "child-two.jsonl"), jsonlUser("Child two"));

  const adapter = new CursorTranscriptAdapter({ transcriptRoot: rootDir });
  const sessions = await adapter.listSessions();

  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].shortId, "d546a303");
  assert.equal(sessions[0].summary, "can you please create a subagent whose job it is to choose three random movies");
  assert.equal(sessions[0].agentCount, 3);
  assert.equal(sessions[0].transcriptPath, join(sessionDir, `${sessionId}.jsonl`));
});

test("falls back to a root session label when no summary is available", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const sessionId = "abc12345-empty";
  const sessionDir = join(rootDir, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, `${sessionId}.jsonl`), JSON.stringify({ role: "assistant", message: { content: [] } }));

  const adapter = new CursorTranscriptAdapter({ transcriptRoot: rootDir });
  const sessions = await adapter.listSessions();

  assert.equal(sessions[0].summary, "Root session abc12345");
});

test("adds subagent tool and error counts from child transcripts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const sessionId = "117990af";
  const childId = "child-1";
  const sessionDir = join(rootDir, sessionId);
  await mkdir(join(sessionDir, "subagents"), { recursive: true });

  await writeFile(
    join(sessionDir, `${sessionId}.jsonl`),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Task",
            input: { resume: childId, description: "Review draft", subagent_type: "code-reviewer" },
          },
        ],
      },
    }),
  );
  await writeFile(
    join(sessionDir, "subagents", `${childId}.jsonl`),
    [
      JSON.stringify({ role: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "ReadFile" }] } }),
      JSON.stringify({ role: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }] } }),
    ].join("\n"),
  );

  const adapter = new CursorTranscriptAdapter({ transcriptRoot: rootDir });
  const graph = await adapter.loadSessionGraph(sessionId);
  const child = graph.nodes.find((node) => node.id === childId);

  assert.equal(child.metrics.toolCount, 1);
  assert.equal(child.metrics.errorCount, 1);
  assert.equal(child.metadata.tools[0].name, "ReadFile");
});

test("recursively follows child agent IDs into top-level transcript directories", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tree-monitor-"));
  const sessionId = "root-session";
  const movieCoordinatorId = "movie-coordinator";
  const linearId = "linear-lookup";
  const casablancaId = "casablanca";
  const matrixId = "matrix";
  const jurassicId = "jurassic";

  await mkdir(join(rootDir, sessionId, "subagents"), { recursive: true });
  await mkdir(join(rootDir, movieCoordinatorId, "subagents"), { recursive: true });

  await writeFile(
    join(rootDir, sessionId, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Subagent",
              input: {
                resume: movieCoordinatorId,
                description: "Coordinate movie lookups",
                subagent_type: "generalPurpose",
                prompt: "Choose movies and launch child lookups.",
              },
            },
            {
              type: "tool_use",
              name: "Subagent",
              input: {
                resume: linearId,
                description: "Check Linear IA-44",
                subagent_type: "generalPurpose",
                prompt: "Check Linear for IA-44 issues.",
              },
            },
          ],
        },
      }),
    ].join("\n"),
  );
  await writeFile(join(rootDir, sessionId, "subagents", `${movieCoordinatorId}.jsonl`), jsonlUser("Coordinate movie lookups"));
  await writeFile(join(rootDir, sessionId, "subagents", `${linearId}.jsonl`), jsonlUser("Check Linear IA-44"));

  await writeFile(
    join(rootDir, movieCoordinatorId, `${movieCoordinatorId}.jsonl`),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Subagent",
            input: { description: "Lookup Casablanca", subagent_type: "generalPurpose" },
          },
          {
            type: "tool_use",
            name: "Subagent",
            input: { description: "Lookup The Matrix", subagent_type: "generalPurpose" },
          },
          {
            type: "tool_use",
            name: "Subagent",
            input: { description: "Lookup Jurassic Park", subagent_type: "generalPurpose" },
          },
        ],
      },
    }),
  );
  await writeFile(join(rootDir, movieCoordinatorId, "subagents", `${casablancaId}.jsonl`), jsonlUser("Return Casablanca roles"));
  await writeFile(join(rootDir, movieCoordinatorId, "subagents", `${matrixId}.jsonl`), jsonlUser("Return The Matrix roles"));
  await writeFile(join(rootDir, movieCoordinatorId, "subagents", `${jurassicId}.jsonl`), jsonlUser("Return Jurassic Park roles"));

  const adapter = new CursorTranscriptAdapter({ transcriptRoot: rootDir });
  const sessions = await adapter.listSessions();
  const graph = await adapter.loadSessionGraph(sessionId);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  assert.equal(sessions.find((session) => session.id === sessionId).agentCount, 6);
  assert.equal(graph.nodes.length, 6);
  assert.equal(byId.get(movieCoordinatorId).parentId, sessionId);
  assert.equal(byId.get(linearId).parentId, sessionId);
  assert.equal(byId.get(casablancaId).parentId, movieCoordinatorId);
  assert.equal(byId.get(matrixId).parentId, movieCoordinatorId);
  assert.equal(byId.get(jurassicId).parentId, movieCoordinatorId);
  assert.equal(byId.get(movieCoordinatorId).summary, "Coordinate movie lookups");
  assert.equal(byId.get(casablancaId).summary, "Lookup Casablanca");
  assert.equal(byId.get(matrixId).summary, "Lookup The Matrix");
  assert.equal(byId.get(jurassicId).summary, "Lookup Jurassic Park");
});

function jsonlUser(query) {
  return JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text: `<user_query>${query}</user_query>` }] },
  });
}
