const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("contributes a persistent activity bar webview view", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

  assert.deepEqual(manifest.activationEvents, ["onView:agentTreeMonitor.view", "onCommand:agentTreeMonitor.open"]);
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, "agentTreeMonitor");
  assert.equal(manifest.contributes.views.agentTreeMonitor[0].id, "agentTreeMonitor.view");
  assert.equal(manifest.contributes.views.agentTreeMonitor[0].type, "webview");
  assert.equal(manifest.contributes.configuration.properties["agentTreeMonitor.modelContextLimits"].type, "object");
});
