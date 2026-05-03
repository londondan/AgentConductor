const DEFAULT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_STALE_WINDOW_MS = 15 * 60 * 1000;

export function inferAgentStatus({
  now,
  modifiedAt,
  lines,
  activityWindowMs = DEFAULT_ACTIVITY_WINDOW_MS,
  staleWindowMs = DEFAULT_STALE_WINDOW_MS,
}) {
  const ageMs = now.getTime() - modifiedAt.getTime();

  if (hasToolResultError(lines)) return { status: "failed", confidence: "inferred", reason: "tool_result_error" };
  if (hasCompletionMarker(lines)) return { status: "completed", confidence: "inferred", reason: "completion_marker" };
  if (ageMs <= activityWindowMs && hasNonTerminalActivity(lines)) {
    return { status: "running", confidence: "inferred", reason: "recent_non_terminal_activity" };
  }
  if (ageMs <= activityWindowMs && hasRecentAssistantText(lines)) {
    return { status: "waiting", confidence: "inferred", reason: "recent_assistant_text" };
  }
  if (ageMs <= activityWindowMs) {
    return { status: "running", confidence: "inferred", reason: "recent_activity" };
  }
  if (ageMs > staleWindowMs && hasNonTerminalActivity(lines)) {
    return { status: "stale", confidence: "inferred", reason: "old_non_terminal_activity" };
  }

  return { status: "unknown", confidence: "estimated", reason: "insufficient_evidence" };
}

function hasToolResultError(lines) {
  return lines.some((line) =>
    (line.message?.content ?? []).some((part) => part.type === "tool_result" && part.is_error),
  );
}

function hasCompletionMarker(lines) {
  const text = lastText(lines).toLowerCase();
  return /\b(completed|complete|finished|done)\b/.test(text) && !/\bwaiting\b/.test(text);
}

function hasNonTerminalActivity(lines) {
  const last = lines.at(-1);
  return (last?.message?.content ?? []).some((part) => part.type === "tool_use");
}

function hasRecentAssistantText(lines) {
  const last = lines.at(-1);
  return last?.role === "assistant" && (last.message?.content ?? []).some((part) => part.type === "text");
}

function lastText(lines) {
  const last = lines.at(-1);
  return (last?.message?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ");
}
