import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProjectExtensionCapabilityConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export type ProjectExtensionDiagnostic = {
  id: string
  name?: string
  manifestPath: string
  enabled: boolean
  available: boolean
  toolCount: number
  reason?: string
}

export type ProjectExtensionToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: ProjectExtensionDiagnostic[]
  loadedExtensions: number
  toolCount: number
  reason?: string
}

type ProjectExtensionManifest = {
  id: string
  name: string
  kind: 'project-extension'
  activation?: string[]
  storage?: string
  headless?: boolean
  runtimeModule?: string
  contributes?: {
    agentTools?: string[]
    skills?: string[]
  }
}

type ProjectExtensionModule = {
  createProjectExtensionTools?: (input: {
    manifest: ProjectExtensionManifest
    manifestPath: string
    extensionRoot: string
    defineTool: typeof LocalToolHost.defineTool
  }) => Promise<unknown[]> | unknown[]
}

export async function buildProjectExtensionToolProviders(
  config: ProjectExtensionCapabilityConfig | undefined
): Promise<ProjectExtensionToolProviderBuildResult> {
  if (!config?.enabled || config.manifests.length === 0) {
    return {
      providers: [],
      diagnostics: [],
      loadedExtensions: 0,
      toolCount: 0,
      reason: !config?.enabled ? 'project extensions are disabled by config' : 'no project extension manifests configured'
    }
  }

  const providers: CapabilityToolProvider[] = []
  const diagnostics: ProjectExtensionDiagnostic[] = []
  for (const manifestPath of uniqueStrings(config.manifests)) {
    const loaded = await loadProjectExtension(manifestPath)
    diagnostics.push(loaded.diagnostic)
    if (loaded.provider) providers.push(loaded.provider)
  }
  const loadedExtensions = providers.length
  const toolCount = providers.reduce((total, provider) => total + provider.tools.length, 0)
  return {
    providers,
    diagnostics,
    loadedExtensions,
    toolCount,
    ...(loadedExtensions === 0
      ? { reason: diagnostics.find((item) => item.reason)?.reason ?? 'no project extensions loaded' }
      : {})
  }
}

async function loadProjectExtension(
  manifestPath: string
): Promise<{ provider?: CapabilityToolProvider; diagnostic: ProjectExtensionDiagnostic }> {
  const resolvedManifestPath = resolve(manifestPath)
  try {
    if (!existsSync(resolvedManifestPath)) {
      throw new Error('extension manifest not found')
    }
    const manifest = parseManifest(JSON.parse(readFileSync(resolvedManifestPath, 'utf8')) as unknown)
    const extensionRoot = dirname(resolvedManifestPath)
    const modulePath = resolve(extensionRoot, manifest.runtimeModule ?? 'dist/index.js')
    if (!isPathWithinOrSame(modulePath, extensionRoot)) {
      throw new Error('extension runtime module must stay within the extension root')
    }
    if (!existsSync(modulePath)) {
      throw new Error(`extension runtime module not found: ${modulePath}`)
    }
    const imported = await import(pathToFileURL(modulePath).href) as ProjectExtensionModule
    if (!imported.createProjectExtensionTools) {
      throw new Error('extension module does not export createProjectExtensionTools')
    }
    const rawTools = await imported.createProjectExtensionTools({
      manifest,
      manifestPath: resolvedManifestPath,
      extensionRoot,
      defineTool: LocalToolHost.defineTool
    })
    const tools = normalizeTools(rawTools, manifest)
    const provider: CapabilityToolProvider = {
      id: `extension:${manifest.id}`,
      kind: 'extension',
      enabled: true,
      available: true,
      tools
    }
    return {
      provider,
      diagnostic: {
        id: manifest.id,
        name: manifest.name,
        manifestPath: resolvedManifestPath,
        enabled: true,
        available: true,
        toolCount: tools.length
      }
    }
  } catch (error) {
    return {
      diagnostic: {
        id: idFromManifestPath(resolvedManifestPath),
        manifestPath: resolvedManifestPath,
        enabled: true,
        available: false,
        toolCount: 0,
        reason: errorMessage(error)
      }
    }
  }
}

function parseManifest(value: unknown): ProjectExtensionManifest {
  const record = recordValue(value)
  const id = stringValue(record.id)
  const name = stringValue(record.name)
  if (!id) throw new Error('extension manifest id is required')
  if (!name) throw new Error('extension manifest name is required')
  if (record.kind !== 'project-extension') throw new Error('extension kind must be project-extension')
  if (record.headless !== true) throw new Error('project extension must be headless')
  const contributes = recordValue(record.contributes)
  return {
    id,
    name,
    kind: 'project-extension',
    activation: stringArray(record.activation),
    storage: stringValue(record.storage),
    headless: true,
    runtimeModule: stringValue(record.runtimeModule),
    contributes: {
      agentTools: stringArray(contributes.agentTools),
      skills: stringArray(contributes.skills)
    }
  }
}

function normalizeTools(rawTools: unknown[], manifest: ProjectExtensionManifest): LocalTool[] {
  const tools = rawTools.filter(isLocalTool)
  const contributed = new Set(manifest.contributes?.agentTools ?? [])
  if (contributed.size > 0) {
    const missing = [...contributed].filter((name) => !tools.some((tool) => tool.name === name))
    if (missing.length > 0) {
      throw new Error(`extension module did not provide contributed tool(s): ${missing.join(', ')}`)
    }
  }
  return tools.map((tool) => ({
    ...tool,
    shouldAdvertise: (context: ToolHostContext) => Boolean(context.workspace) &&
      (tool.shouldAdvertise ? tool.shouldAdvertise(context) : true)
  }))
}

function isLocalTool(value: unknown): value is LocalTool {
  const record = recordValue(value)
  return Boolean(
    stringValue(record.name) &&
    stringValue(record.description) &&
    Object.keys(recordValue(record.inputSchema)).length > 0 &&
    typeof record.execute === 'function'
  )
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function isPathWithinOrSame(path: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function idFromManifestPath(path: string): string {
  return path.split(/[\\/]/).slice(-2, -1)[0] || 'unknown-extension'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
