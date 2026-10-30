// p5-ws-scope.mjs
var active = false;
async function activate() {
  active = true;
}
async function deactivate() {
  active = false;
}
async function dispose() {
  active = false;
}
function getCapabilityDefinitions() {
  return [{
    descriptor: {
      contractVersion: 3,
      id: "fixture.ws.echo",
      version: "0.1.0",
      title: "Echo workspace",
      description: "Echoes the workspaceRoot the plugin child actually received (workspace binding probe).",
      audiences: ["agent", "ui", "system"],
      scope: "workspace",
      resourceKinds: [],
      effect: "workspace-write",
      approval: "none",
      concurrency: { revision: "none", idempotency: "required" },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      tags: ["fixture", "ws-scope"]
    },
    handler: async (input) => {
      if (!active) throw new Error("ws-scope fixture is not active");
      return { output: { workspaceRoot: typeof input.workspaceRoot === "string" ? input.workspaceRoot : null } };
    }
  }];
}
function smoke() {
  if (!active) throw new Error("ws-scope fixture is not active");
  return { ok: true };
}
export {
  activate,
  deactivate,
  dispose,
  getCapabilityDefinitions,
  smoke
};
