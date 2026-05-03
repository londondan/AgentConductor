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
  ]);

  assert.deepEqual(options, {
    adapter: "cursor-transcript",
    root: "/tmp/transcripts",
    session: "latest",
    refreshSeconds: 2,
    unicode: false,
    once: false,
  });
});
