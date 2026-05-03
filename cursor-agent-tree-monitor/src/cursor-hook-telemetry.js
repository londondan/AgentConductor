import { readFile } from "node:fs/promises";

// Reads the compact telemetry JSONL produced by `hooks/record-model.cjs` and
// returns an index that supports several lookup strategies, in order of
// preference:
//
//   1. modelForConversation(conversationId)
//        Direct match by Cursor `conversation_id` / `session_id`. Used for the
//        root orchestrator since its conversation ID matches the transcript
//        directory name.
//
//   2. modelForSubagentToolUse(parentConversationId, toolUseId)
//        Direct match by `parent_conversation_id` + `subagent_id`
//        (Cursor's tool-use ID). Only works when the parent transcript actually
//        records the tool-use ID on the spawning Task call. Cursor currently
//        does NOT record this in transcript JSONL, so this lookup is provided
//        for compatibility / future-proofing.
//
//   3. subagentEventsForParent(parentConversationId)
//        Returns the chronologically ordered list of subagentStop events for a
//        parent conversation. The Cursor adapter uses ordinal matching (Nth
//        completed subagent transcript ↔ Nth completed event) because Cursor
//        emits no usable join key between hook events and child transcripts.
//
//   4. modelHistoryForConversation(conversationId)
//      modelHistoryForSubagent(parentConversationId, subagentId)
//        Full ordered list of (model, recordedAt) pairs for drift detection.
export async function readCursorHookTelemetry(path) {
  const conversationModels = new Map();
  const subagentModels = new Map();
  const conversationHistory = new Map();
  const subagentHistory = new Map();
  const subagentEventsByParent = new Map();

  if (!path) {
    return telemetryIndex({
      conversationModels,
      subagentModels,
      conversationHistory,
      subagentHistory,
      subagentEventsByParent,
    });
  }

  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return telemetryIndex({
      conversationModels,
      subagentModels,
      conversationHistory,
      subagentHistory,
      subagentEventsByParent,
    });
  }

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof event.model !== "string" || !event.model.trim()) continue;
    const model = event.model.trim();
    const recordedAt = typeof event.recordedAt === "string" ? event.recordedAt : null;

    // IMPORTANT: Cursor's `subagentStop` payload sets `conversation_id` to the
    // PARENT conversation, not the subagent's own conversation. If we accumulate
    // those events into `conversationHistory`, the root node sees every
    // subagent's model as if it were its own and `modelSwapped` becomes true
    // for any session that mixed models across subagents. Restrict the
    // conversation-keyed indices to non-subagent events (e.g. `sessionStart`).
    if (event.conversationId && !isSubagentStopEvent(event.event)) {
      conversationModels.set(event.conversationId, model);
      pushHistory(conversationHistory, event.conversationId, { model, recordedAt, event: event.event });
    }

    if (event.parentConversationId && event.subagentId) {
      const key = subagentKey(event.parentConversationId, event.subagentId);
      subagentModels.set(key, model);
      pushHistory(subagentHistory, key, { model, recordedAt, event: event.event });
    }

    if (event.parentConversationId && isSubagentStopEvent(event.event)) {
      pushList(subagentEventsByParent, event.parentConversationId, {
        recordedAt,
        recordedAtMs: parseTimestamp(recordedAt),
        subagentId: event.subagentId ?? null,
        subagentType: event.subagentType ?? null,
        model,
        status: event.status ?? null,
        durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
      });
    }
  }

  for (const events of subagentEventsByParent.values()) {
    events.sort(byRecordedAt);
  }

  return telemetryIndex({
    conversationModels,
    subagentModels,
    conversationHistory,
    subagentHistory,
    subagentEventsByParent,
  });
}

function telemetryIndex({ conversationModels, subagentModels, conversationHistory, subagentHistory, subagentEventsByParent }) {
  return {
    modelForConversation(conversationId) {
      return conversationModels.get(conversationId) ?? null;
    },
    modelForSubagentToolUse(parentConversationId, toolUseId) {
      return subagentModels.get(subagentKey(parentConversationId, toolUseId)) ?? null;
    },
    subagentEventsForParent(parentConversationId) {
      return [...(subagentEventsByParent.get(parentConversationId) ?? [])];
    },
    modelHistoryForConversation(conversationId) {
      return [...(conversationHistory.get(conversationId) ?? [])];
    },
    modelHistoryForSubagent(parentConversationId, subagentId) {
      return [...(subagentHistory.get(subagentKey(parentConversationId, subagentId)) ?? [])];
    },
  };
}

function subagentKey(parentConversationId, toolUseId) {
  return `${parentConversationId}:${toolUseId}`;
}

function isSubagentStopEvent(eventName) {
  return typeof eventName === "string" && /subagent.?stop/i.test(eventName);
}

function pushHistory(map, key, entry) {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function pushList(map, key, entry) {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function parseTimestamp(value) {
  if (typeof value !== "string") return Number.POSITIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function byRecordedAt(a, b) {
  return a.recordedAtMs - b.recordedAtMs;
}
