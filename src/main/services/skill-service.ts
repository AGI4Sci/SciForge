import { existsSync, readdirSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  createWorkspaceIntelService,
  type WorkspaceSkillSummary
} from '../../../packages/workers/workspace-intel/src/index.js'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { projectExtensionSkillRootsForRuntime } from './project-extension-service'
import { expandHomePath } from './workspace-service'

export type GuiSkillScope = 'project' | 'global'

export type GuiSkillSummary = {
  id: string
  name: string
  description?: string
  root: string
  entryPath: string
  scope: GuiSkillScope
  legacy: boolean
}

export type GuiSkillListResult =
  | { ok: true; skills: GuiSkillSummary[]; validationErrors: Array<{ root: string; message: string }> }
  | { ok: false; message: string }

export type GuiSkillRoot = {
  path: string
  scope: GuiSkillScope
}

export async function guiSkillRootsForRuntime(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): Promise<GuiSkillRoot[]> {
  if (!settings && !workspaceRootOverride) return []
  const workspaceRoots = uniqueStrings([
    workspaceRootOverride,
    settings?.workspaceRoot,
    settings?.remoteChannel.im.workspaceRoot,
    settings?.schedule.defaultWorkspaceRoot,
    ...(settings?.remoteChannel.channels.map((channel) => channel.workspaceRoot) ?? []),
    ...(settings?.schedule.tasks.map((task) => task.workspaceRoot) ?? [])
  ].map(normalizeSkillRootPath).filter(Boolean))
  const projectRoots = workspaceRoots.flatMap((workspaceRoot) => [
    join(workspaceRoot, '.codex', 'skills'),
    join(workspaceRoot, '.agents', 'skills'),
    join(workspaceRoot, 'skills')
  ])
  const globalRoots = [
    join(homedir(), '.agents', 'skills'),
    join(homedir(), '.sciforge', 'skills'),
    ...await discoverCodexPluginSkillRoots()
  ]
  const configuredExtraRoots = [
    ...(settings?.remoteChannel.skills.extraDirs ?? []),
    ...(settings?.schedule.skills.extraDirs ?? [])
  ].map(normalizeSkillRootPath)
  const extensionSkillRoots = await projectExtensionSkillRootsForRuntime(settings, workspaceRootOverride)

  return uniqueSkillRoots([
    ...projectRoots
      .filter((root) => existsSync(root))
      .map((path) => ({ path, scope: 'project' as const })),
    ...extensionSkillRoots
      .filter((root) => existsSync(root))
      .map((path) => ({ path, scope: 'project' as const })),
    ...globalRoots
      .filter((root) => existsSync(root))
      .map((path) => ({ path, scope: 'global' as const })),
    ...configuredExtraRoots
      .filter(Boolean)
      .map((path) => ({ path, scope: scopeForConfiguredRoot(path, workspaceRoots) }))
  ])
}

export async function listGuiSkills(
  settings: AppSettingsV1,
  workspaceRootOverride?: string
): Promise<GuiSkillListResult> {
  try {
    const roots = await guiSkillRootsForRuntime(settings, workspaceRootOverride)
    const skills: GuiSkillSummary[] = []
    const validationErrors: Array<{ root: string; message: string }> = []
    for (const root of roots) {
      const listed = await listGuiSkillsFromWorkspaceIntelRoot(root)
      if (!listed.ok) {
        validationErrors.push({ root: root.path, message: listed.message })
        continue
      }
      skills.push(...listed.skills)
      validationErrors.push(...listed.validationErrors)
    }
    return {
      ok: true,
      skills: dedupeSkills(skills),
      validationErrors
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export function normalizeSkillRootPath(path: string | undefined): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  return resolve(expandHomePath(trimmed))
}

async function listGuiSkillsFromWorkspaceIntelRoot(
  root: GuiSkillRoot
): Promise<GuiSkillListResult> {
  const service = createWorkspaceIntelService({
    workspaceRoot: root.path,
    skillRoots: [root.path]
  })
  const result = await service.listSkills({ workspaceRoot: root.path })
  if (!result.ok) {
    return { ok: false, message: result.error.message }
  }
  return {
    ok: true,
    skills: result.skills.map((skill) => guiSkillFromWorkspaceIntel(root, skill)),
    validationErrors: result.validationErrors
  }
}

function guiSkillFromWorkspaceIntel(root: GuiSkillRoot, skill: WorkspaceSkillSummary): GuiSkillSummary {
  const packageRoot = skill.packageRelativePath ? join(root.path, skill.packageRelativePath) : root.path
  const entryPath = skill.entryRelativePath ? join(root.path, skill.entryRelativePath) : join(packageRoot, 'SKILL.md')
  return {
    id: skill.id,
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
    root: packageRoot,
    entryPath,
    scope: root.scope,
    legacy: skill.legacy
  }
}

async function discoverCodexPluginSkillRoots(): Promise<string[]> {
  const roots: string[] = []
  await collectSkillRoots(join(homedir(), '.codex', 'plugins', 'cache'), roots, 0, 5)
  return roots
}

async function collectSkillRoots(root: string, roots: string[], depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth || !existsSync(root)) return
  if (basename(root) === 'skills' && skillRootHasPackages(root)) {
    roots.push(root)
    return
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => collectSkillRoots(join(root, entry.name), roots, depth + 1, maxDepth)))
}

function skillRootHasPackages(root: string): boolean {
  if (existsSync(join(root, 'SKILL.md')) || existsSync(join(root, 'skill.json'))) return true
  try {
    return readdirSync(root, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() &&
      (existsSync(join(root, entry.name, 'SKILL.md')) || existsSync(join(root, entry.name, 'skill.json')))
    )
  } catch {
    return false
  }
}

function dedupeSkills(skills: GuiSkillSummary[]): GuiSkillSummary[] {
  const unique = new Map<string, GuiSkillSummary>()
  for (const skill of skills.sort(compareSkillSummary)) {
    if (!unique.has(skill.id)) unique.set(skill.id, skill)
  }
  return [...unique.values()]
}

function compareSkillSummary(a: GuiSkillSummary, b: GuiSkillSummary): number {
  if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1
  return a.name.localeCompare(b.name)
}

function scopeForConfiguredRoot(path: string, workspaceRoots: string[]): GuiSkillScope {
  const comparable = comparablePath(path)
  return workspaceRoots.some((workspaceRoot) => {
    const workspace = comparablePath(workspaceRoot)
    return comparable === workspace || comparable.startsWith(`${workspace}/`)
  }) ? 'project' : 'global'
}

function uniqueSkillRoots(roots: GuiSkillRoot[]): GuiSkillRoot[] {
  const seen = new Set<string>()
  const out: GuiSkillRoot[] = []
  for (const root of roots) {
    const key = comparablePath(root.path)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(root)
  }
  return out
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

function comparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
