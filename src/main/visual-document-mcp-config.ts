import {
  buildManagedGuiLocalRuntimeMcpServerConfig,
  buildManagedGuiMcpJsonServerConfig,
  ELECTRON_RUN_AS_NODE_ENV,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'
import {
  SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG,
  SCIFORGE_VISUAL_DOCUMENT_TOOL_SIDE_EFFECTS
} from '../../packages/workers/visual-document/src/contract'

export const GUI_VISUAL_DOCUMENT_MCP_SERVER_NAME = 'visual_document'
const GUI_VISUAL_DOCUMENT_MCP_NODE_ENTRY = 'out/main/visual-document-mcp-node-entry.js'
export const GUI_VISUAL_DOCUMENT_MCP_TIMEOUT_MS = 30_000
export const GUI_VISUAL_DOCUMENT_MCP_LAUNCH_FLAG = SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG
// Cleanup-only name. It is never registered or exposed as a runnable alias.
export const RETIRED_GUI_VISUAL_DOCUMENT_MCP_SERVER_NAMES = ['sciforge_canvas'] as const

export type VisualDocumentMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_VISUAL_DOCUMENT_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_VISUAL_DOCUMENT_MCP_SERVER_NAME,
  nodeEntry: GUI_VISUAL_DOCUMENT_MCP_NODE_ENTRY,
  launchFlag: GUI_VISUAL_DOCUMENT_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_VISUAL_DOCUMENT_MCP_TIMEOUT_MS,
  enabledTools: visualDocumentMcpEnabledTools
}

export function buildVisualDocumentMcpArgs(
  launch: VisualDocumentMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveVisualDocumentMcpNodeEntryPath(launch),
    GUI_VISUAL_DOCUMENT_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)

  return args
}

export function resolveVisualDocumentMcpNodeEntryPath(launch: VisualDocumentMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_VISUAL_DOCUMENT_MCP_NODE_ENTRY)
}

export function resolveVisualDocumentMcpCommand(
  launch: VisualDocumentMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildVisualDocumentMcpServerConfig(
  launch: VisualDocumentMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_VISUAL_DOCUMENT_MCP_DESCRIPTOR,
    launch,
    args: buildVisualDocumentMcpArgs(launch, normalizedWorkspaceRoot),
    env: workerMcpEnv(),
    existing: normalizedWorkspaceRoot ? {
      trustScope: 'workspace',
      trustedWorkspaceRoots: [normalizedWorkspaceRoot]
    } : undefined
  })
}

export function buildVisualDocumentLocalRuntimeMcpServerConfig(
  launch: VisualDocumentMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_VISUAL_DOCUMENT_MCP_DESCRIPTOR,
    launch,
    args: buildVisualDocumentMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv(),
    existing
  })
}

export function buildVisualDocumentMcpJsonServerConfig(
  launch: VisualDocumentMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_VISUAL_DOCUMENT_MCP_DESCRIPTOR,
    launch,
    args: buildVisualDocumentMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv()
  })
}

export function buildVisualDocumentMcpConfigFragment(
  launch: VisualDocumentMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [GUI_VISUAL_DOCUMENT_MCP_SERVER_NAME]: buildVisualDocumentMcpServerConfig(launch, workspaceRoot)
    }
  }
}

export function visualDocumentMcpEnabledTools(): string[] {
  return Object.keys(SCIFORGE_VISUAL_DOCUMENT_TOOL_SIDE_EFFECTS)
}

function workerMcpEnv(): Record<string, string> {
  return { ...ELECTRON_RUN_AS_NODE_ENV }
}
