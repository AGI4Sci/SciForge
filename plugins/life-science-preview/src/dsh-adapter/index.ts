/**
 * Runtime-plugin entry (named-runner contract shape, same lifecycle surface
 * as the biology-room / visual-review plugins).
 *
 * This plugin contributes NO capabilities: getCapabilityDefinitions()
 * returns an empty list on purpose. Its payload is the six workspace-preview
 * providers exposed through getWorkspacePreviewProviders() (SDK
 * workspace-preview contribution channel, gap-1b); see
 * ./register-preview-contributions.ts. The plugin-owned declaration lives in
 * ../../sciforge.adapter.json (kind "workspace-preview" + previewSlots), and
 * the Host approves the exact package/runtime version pair through its
 * adapter contract map.
 */
import type { LifeSciencePorts } from '../ports/index.js'
import {
  createLifeScienceWorkspacePreviewContributions,
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS
} from './contributions.js'
import { createRealDataPorts } from './data-services.js'
import { createNodeFilePorts } from './node-file-ports.js'

export { getWorkspacePreviewProviders } from './register-preview-contributions.js'

export function createPluginPorts(): LifeSciencePorts {
  const nodePorts = createNodeFilePorts()
  return {
    files: nodePorts.read,
    writes: nodePorts.write,
    data: createRealDataPorts()
  }
}

export function createPluginContributions(ports: LifeSciencePorts) {
  return createLifeScienceWorkspacePreviewContributions(
    LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map((contract) => ({ id: contract.contributionId })),
    'main.workspace-preview-plugin',
    'main',
    ports
  )
}

export async function activate(): Promise<void> {
}

export async function deactivate(): Promise<void> {
}

export async function unregister(): Promise<void> {
}

export async function dispose(): Promise<void> {
}

export function getCapabilityDefinitions() {
  // This plugin contributes workspace-preview providers, not capabilities.
  return []
}
