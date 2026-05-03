const path = require("node:path");

function toCursorProjectSlug(workspacePath) {
  return workspacePath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "-");
}

function resolveTranscriptRoot({ explicitRoot, homeDir, workspacePath }) {
  if (explicitRoot) return explicitRoot;
  if (!homeDir || !workspacePath) {
    throw new Error("Cannot resolve Cursor transcript root without a workspace path");
  }

  return path.join(homeDir, ".cursor", "projects", toCursorProjectSlug(workspacePath), "agent-transcripts");
}

module.exports = {
  resolveTranscriptRoot,
  toCursorProjectSlug,
};
