// Legacy AgentServer gateway compatibility export.
// Retirement condition: remove this shim after the workspace server default path
// calls the Codex app-server bridge directly, UI projection imports have moved to
// neutral GUI/runtime contracts, and replacement Codex bridge smokes cover the
// AgentServer script set without relying on AgentServer fixtures.
export { runWorkspaceRuntimeGateway } from './generation-gateway.js';
export { composeRuntimeUiManifest } from './runtime-ui-manifest.js';
