const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveTranscriptRoot, toCursorProjectSlug } = require("../src/session.cjs");

test("converts a workspace path into Cursor's project slug format", () => {
  assert.equal(toCursorProjectSlug("/Users/danjames/repo/dev"), "Users-danjames-repo-dev");
});

test("resolves the default transcript root for a workspace", () => {
  assert.equal(
    resolveTranscriptRoot({
      homeDir: "/Users/danjames",
      workspacePath: "/Users/danjames/repo/dev",
    }),
    path.join("/Users/danjames", ".cursor", "projects", "Users-danjames-repo-dev", "agent-transcripts"),
  );
});

test("allows an explicit transcript root override", () => {
  assert.equal(
    resolveTranscriptRoot({
      explicitRoot: "/tmp/transcripts",
      homeDir: "/Users/danjames",
      workspacePath: "/Users/danjames/repo/dev",
    }),
    "/tmp/transcripts",
  );
});
