export function extractToolAttribution(lines) {
  const toolsById = new Map();

  for (const line of lines) {
    for (const part of line.message?.content ?? []) {
      if (part.type === "tool_use") {
        const id = part.id ?? part.tool_use_id;
        if (!id) continue;
        toolsById.set(id, {
          id,
          name: part.name ?? "unknown",
          input: part.input,
          result: null,
        });
      }

      if (part.type === "tool_result") {
        const id = part.tool_use_id ?? part.id;
        if (!id) continue;
        const existing = toolsById.get(id) ?? { id, name: "unknown", input: undefined, result: null };
        toolsById.set(id, {
          ...existing,
          result: {
            isError: Boolean(part.is_error),
            content: part.content,
          },
        });
      }
    }
  }

  const tools = [...toolsById.values()];
  return {
    toolCount: tools.length,
    errorCount: tools.filter((tool) => tool.result?.isError).length,
    tools,
  };
}
