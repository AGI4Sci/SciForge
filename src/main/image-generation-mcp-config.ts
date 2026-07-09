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
  IMAGE_GENERATION_MCP_FLAG,
  IMAGE_GENERATION_TOOL_SIDE_EFFECTS
} from '../../packages/workers/image-generation/src/contract'
import {
  getImageGenerationSettings,
  getModelRouterSettings,
  type AppSettingsV1,
} from '../shared/app-settings'
import { resolveRuntimeModelRouterSettings } from '../shared/app-settings-model-router'

export const GUI_IMAGE_GENERATION_MCP_SERVER_NAME = 'image_generation'
const GUI_IMAGE_GENERATION_MCP_NODE_ENTRY = 'out/main/image-generation-mcp-node-entry.js'
const COMPONENT_SEGMENTATION_RUNNER_ENV = 'SCIFORGE_COMPONENT_SEGMENTATION_RUNNER'
const COMPONENT_SEGMENTATION_MODEL_ENV = 'SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH'
const FASTSAM_RUNNER_ENV = 'SCIFORGE_FASTSAM_RUNNER'
const FASTSAM_MODEL_ENV = 'SCIFORGE_FASTSAM_MODEL_PATH'
export const GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS = 120_000
export const GUI_IMAGE_GENERATION_MCP_LAUNCH_FLAG = IMAGE_GENERATION_MCP_FLAG

export type ImageGenerationMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_IMAGE_GENERATION_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
  nodeEntry: GUI_IMAGE_GENERATION_MCP_NODE_ENTRY,
  launchFlag: GUI_IMAGE_GENERATION_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS,
  enabledTools: imageGenerationMcpEnabledTools
}

export function buildImageGenerationMcpArgs(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveImageGenerationMcpNodeEntryPath(launch),
    GUI_IMAGE_GENERATION_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)

  return args
}

export function resolveImageGenerationMcpNodeEntryPath(launch: ImageGenerationMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_IMAGE_GENERATION_MCP_NODE_ENTRY)
}

export function resolveImageGenerationMcpCommand(
  launch: ImageGenerationMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildImageGenerationMcpServerConfig(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string,
  settings?: AppSettingsV1
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
    launch,
    args: buildImageGenerationMcpArgs(launch, normalizedWorkspaceRoot),
    env: imageGenerationMcpEnv(launch, settings),
    existing: normalizedWorkspaceRoot ? {
      trustScope: 'workspace',
      trustedWorkspaceRoots: [normalizedWorkspaceRoot]
    } : undefined
  })
}

export function buildImageGenerationLocalRuntimeMcpServerConfig(
  launch: ImageGenerationMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string,
  settings?: AppSettingsV1
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
    launch,
    args: buildImageGenerationMcpArgs(launch, workspaceRoot?.trim()),
    env: imageGenerationMcpEnv(launch, settings),
    existing
  })
}

export function buildImageGenerationMcpJsonServerConfig(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string,
  settings?: AppSettingsV1
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
    launch,
    args: buildImageGenerationMcpArgs(launch, workspaceRoot?.trim()),
    env: imageGenerationMcpEnv(launch, settings)
  })
}

export function buildImageGenerationMcpConfigFragment(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string,
  settings?: AppSettingsV1
): JsonRecord {
  return {
    servers: {
      [GUI_IMAGE_GENERATION_MCP_SERVER_NAME]: buildImageGenerationMcpServerConfig(
        launch,
        workspaceRoot,
        settings
      )
    }
  }
}

export function imageGenerationMcpEnabledTools(): string[] {
  return Object.keys(IMAGE_GENERATION_TOOL_SIDE_EFFECTS)
}

export function imageGenerationMcpSettingsChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  const prevSegmentation = getImageGenerationSettings(prev)
  const nextSegmentation = getImageGenerationSettings(next)
  if (
    prevSegmentation.componentSegmentationRunnerPath.trim() !==
    nextSegmentation.componentSegmentationRunnerPath.trim()
  ) {
    return true
  }
  if (
    prevSegmentation.componentSegmentationModelPath.trim() !==
    nextSegmentation.componentSegmentationModelPath.trim()
  ) {
    return true
  }

  const a = getModelRouterSettings(prev).profiles.default.imageGenerator
  const b = getModelRouterSettings(next).profiles.default.imageGenerator
  const aConfigured = Boolean(a.apiKey.trim() && a.baseUrl.trim() && a.model.trim())
  const bConfigured = Boolean(b.apiKey.trim() && b.baseUrl.trim() && b.model.trim())

  if (aConfigured !== bConfigured) return true
  if (!aConfigured && !bConfigured) return false

  return (
    a.provider !== b.provider ||
    a.apiKey.trim() !== b.apiKey.trim() ||
    a.baseUrl.trim() !== b.baseUrl.trim() ||
    a.model.trim() !== b.model.trim()
  )
}

export function imageGenerationMcpEnv(
  launch: ImageGenerationMcpLaunchConfig,
  settings?: AppSettingsV1
): Record<string, string> {
  void launch
  const env: Record<string, string> = { ...ELECTRON_RUN_AS_NODE_ENV }
  if (!settings) return env
  const imageGeneration = getImageGenerationSettings(settings)
  if (imageGeneration.componentSegmentationRunnerPath.trim()) {
    env[COMPONENT_SEGMENTATION_RUNNER_ENV] = imageGeneration.componentSegmentationRunnerPath.trim()
    env[FASTSAM_RUNNER_ENV] = imageGeneration.componentSegmentationRunnerPath.trim()
  }
  if (imageGeneration.componentSegmentationModelPath.trim()) {
    env[COMPONENT_SEGMENTATION_MODEL_ENV] = imageGeneration.componentSegmentationModelPath.trim()
    env[FASTSAM_MODEL_ENV] = imageGeneration.componentSegmentationModelPath.trim()
  }
  const imageGenerator = getModelRouterSettings(settings).profiles.default.imageGenerator
  if (!imageGenerator.apiKey.trim() || !imageGenerator.baseUrl.trim() || !imageGenerator.model.trim()) return env
  const router = resolveRuntimeModelRouterSettings(settings)
  if (!router.baseUrl || !router.apiKey || !router.model) return env
  env.SCIFORGE_MODEL_ROUTER_BASE_URL = router.baseUrl
  env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = router.apiKey
  env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = router.model
  return env
}
