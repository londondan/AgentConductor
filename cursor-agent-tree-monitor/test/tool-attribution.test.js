import test from "node:test";
import assert from "node:assert/strict";

import { extractToolAttribution } from "../src/tool-attribution.js";

test("pairs tool_use and tool_result blocks by tool_use_id", () => {
  const attribution = extractToolAttribution([
    {
      role: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "ReadFile",
            input: { path: "README.md" },
          },
        ],
      },
    },
    {
      role: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            is_error: true,
            content: "missing file",
          },
        ],
      },
    },
  ]);

  assert.equal(attribution.toolCount, 1);
  assert.equal(attribution.errorCount, 1);
  assert.deepEqual(attribution.tools, [
    {
      id: "tool-1",
      name: "ReadFile",
      input: { path: "README.md" },
      result: { isError: true, content: "missing file" },
    },
  ]);
});
