import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { expandHomePath } from './workspace-service'

export type ProjectExtensionSummary = {
  id: string
  name: string
  manifestPath: string
  root: string
  runtimeModulePath?: string
  skillRoot?: string
  agentTools: string[]
}

export async function projectExtensionManifestsForRuntime(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): Promise<string[]> {
  const extensions = await discoverProjectExtensions(settings, workspaceRootOverride)
  return extensions.map((extension) => extension.manifestPath)
}

export async function projectExtensionSkillRootsForRuntime(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): Promise<string[]> {
  const extensions = await discoverProjectExtensions(settings, workspaceRootOverride)
  return extensions.map((extension) => extension.skillRoot).filter((root): root is string => Boolean(root))
}

export async function discoverProjectExtensions(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): Promise<ProjectExtensionSummary[]> {
  const workspaceRoots = workspaceRootsForSettings(settings, workspaceRootOverride)
  const discovered: ProjectExtensionSummary[] = []
  for (const workspaceRoot of workspaceRoots) {
    const extensionsRoot = join(workspaceRoot, 'extensions')
    if (!existsSync(extensionsRoot)) continue
    const entries = await readdir(extensionsRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = join(extensionsRoot, entry.name, 'extension.json')
      const extension = await readProjectExtensionManifest(manifestPath).catch(() => null)
      if (extension) discovered.push(extension)
    }
  }
  return dedupeExtensions(discovered)
}

async function readProjectExtensionManifest(manifestPath: string): Promise<ProjectExtensionSummary | null> {
  if (!existsSync(manifestPath)) return null
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  const manifest = recordValue(parsed)
  if (manifest.kind !== 'project-extension' || manifest.headless !== true) return null
  const id = stringValue(manifest.id)
  const name = stringValue(manifest.name)
  if (!id || !name) return null
  const root = dirname(manifestPath)
  const runtimeModule = stringValue(manifest.runtimeModule)
  const skillRoot = join(root, 'skill')
  const contributes = recordValue(manifest.contributes)
  return {
    id,
    name,
    manifestPath,
    root,
    ...(runtimeModule ? { runtimeModulePath: resolve(root, runtimeModule) } : {}),
    ...(existsSync(skillRoot) ? { skillRoot } : {}),
    agentTools: stringArray(contributes.agentTools)
  }
}

function workspaceRootsForSettings(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): string[] {
  const override = normalizePath(workspaceRootOverride)
  if (override) return [override]
  if (!settings) return []
  return uniqueStrings([
    settings?.workspaceRoot,
    settings?.remoteChannel.im.workspaceRoot,
    settings?.schedule.defaultWorkspaceRoot,
    ...(settings?.remoteChannel.channels.map((channel) => channel.workspaceRoot) ?? []),
    ...(settings?.schedule.tasks.map((task) => task.workspaceRoot) ?? [])
  ].map(normalizePath).filter(Boolean))
}

function normalizePath(path: string | undefined): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  return resolve(expandHomePath(trimmed))
}

function dedupeExtensions(extensions: ProjectExtensionSummary[]): ProjectExtensionSummary[] {
  const seen = new Set<string>()
  const out: ProjectExtensionSummary[] = []
  for (const extension of extensions) {
    const key = extension.manifestPath.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(extension)
  }
  return out
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
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
