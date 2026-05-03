import test from "node:test";
import assert from "node:assert/strict";

import { parseCliArgs } from "../src/cli.js";

test("parses CLI options for Cursor transcript monitoring", () => {
  const options = parseCliArgs([
    "--adapter",
    "cursor-transcript",
    "--root",
    "/tmp/transcripts",
    "--session",
    "latest",
    "--refresh",
    "2",
    "--ascii",
    "--model-telemetry",
    "/tmp/events.jsonl",
  ]);

  assert.deepEqual(options, {
    adapter: "cursor-transcript",
    root: "/tmp/transcripts",
    session: "latest",
    refreshSeconds: 2,
    unicode: false,
    once: false,
    modelTelemetryPath: "/tmp/events.jsonl",
  });
});

test("--no-model-telemetry disables hook merging", () => {
  const options = parseCliArgs(["--root", "/tmp", "--no-model-telemetry"]);
  assert.equal(options.modelTelemetryPath, null);
});

test("defaults modelTelemetryPath to AGENT_TREE_MODEL_EVENTS or the cursor data dir", () => {
  const options = parseCliArgs(["--root", "/tmp"]);
  assert.ok(
    typeof options.modelTelemetryPath === "string" && options.modelTelemetryPath.length > 0,
    "should default to a non-empty path",
  );
});
