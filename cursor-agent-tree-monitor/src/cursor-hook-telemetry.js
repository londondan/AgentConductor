import { readFile } from "node:fs/promises";

export async function readCursorHookTelemetry(path) {
  const conversationModels = new Map();
  const subagentModels = new Map();

  if (!path) return telemetryIndex(conversationModels, subagentModels);

  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return telemetryIndex(conversationModels, subagentModels);
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
    if (event.conversationId) conversationModels.set(event.conversationId, model);
    if (event.parentConversationId && event.subagentId) {
      subagentModels.set(subagentKey(event.parentConversationId, event.subagentId), model);
    }
  }

  return telemetryIndex(conversationModels, subagentModels);
}

function telemetryIndex(conversationModels, subagentModels) {
  return {
    modelForConversation(conversationId) {
      return conversationModels.get(conversationId) ?? null;
    },
    modelForSubagentToolUse(parentConversationId, toolUseId) {
      return subagentModels.get(subagentKey(parentConversationId, toolUseId)) ?? null;
    },
  };
}

function subagentKey(parentConversationId, toolUseId) {
  return `${parentConversationId}:${toolUseId}`;
}
