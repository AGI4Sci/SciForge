import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export type ParsedExperimentArtifacts = {
  metrics?: Record<string, unknown>
  logsExcerpt?: string
  artifactRefs: string[]
}

const DEFAULT_LOG_EXCERPT_CHARS = 6000

export function parseExperimentArtifacts(input: {
  workspaceRoot: string
  metrics?: Record<string, unknown>
  metricsPath?: string
  logsExcerpt?: string
  logPath?: string
  artifactRefs?: string[]
  artifactManifestPath?: string
}): ParsedExperimentArtifacts {
  const metrics = input.metrics ?? readJsonRecord(input.workspaceRoot, input.metricsPath)
  const logsExcerpt = input.logsExcerpt ?? readLogExcerpt(input.workspaceRoot, input.logPath)
  const artifactRefs = uniqueStrings([
    ...(input.artifactRefs ?? []),
    ...readArtifactManifest(input.workspaceRoot, input.artifactManifestPath)
  ])
  return {
    ...(metrics ? { metrics } : {}),
    ...(logsExcerpt ? { logsExcerpt } : {}),
    artifactRefs
  }
}

export function toWorkspaceEvidenceRef(workspaceRoot: string, prefix: 'artifact' | 'file', path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.includes(':')) return trimmed
  const absolute = resolvePath(workspaceRoot, trimmed)
  const rel = relative(workspaceRoot, absolute).replace(/\\/g, '/')
  return `${prefix}:${rel || trimmed}`
}

function readJsonRecord(workspaceRoot: string, path: string | undefined): Record<string, unknown> | undefined {
  if (!path?.trim()) return undefined
  const absolute = resolvePath(workspaceRoot, path)
  if (!existsSync(absolute)) return undefined
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown
  return isRecord(parsed) ? parsed : undefined
}

function readLogExcerpt(workspaceRoot: string, path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined
  const absolute = resolvePath(workspaceRoot, path)
  if (!existsSync(absolute)) return undefined
  const text = readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n')
  if (text.length <= DEFAULT_LOG_EXCERPT_CHARS) return text
  const head = text.slice(0, DEFAULT_LOG_EXCERPT_CHARS / 2)
  const tail = text.slice(-DEFAULT_LOG_EXCERPT_CHARS / 2)
  return `${head}\n...[log excerpt truncated]...\n${tail}`
}

function readArtifactManifest(workspaceRoot: string, path: string | undefined): string[] {
  if (!path?.trim()) return []
  const absolute = resolvePath(workspaceRoot, path)
  if (!existsSync(absolute)) return []
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown
  if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string')
  if (!isRecord(parsed)) return []
  const artifacts = parsed.artifacts
  if (Array.isArray(artifacts)) {
    return artifacts
      .map((item) => typeof item === 'string' ? item : isRecord(item) ? stringValue(item.path) || stringValue(item.ref) : '')
      .filter(Boolean)
  }
  return []
}

function resolvePath(workspaceRoot: string, path: string): string {
  const normalized = path.trim()
  const root = resolve(workspaceRoot)
  const absolute = isAbsolute(normalized) ? resolve(normalized) : resolve(root, normalized)
  if (!isPathWithinOrSame(absolute, root)) {
    throw new Error(`Research Memory artifact path must stay within the workspace: ${path}`)
  }
  return absolute
}

function isPathWithinOrSame(path: string, parent: string): boolean {
  const rel = relative(parent, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
