import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const WORKSPACE_BINDING_DOMAIN = 'sciforge.research-checkpoint.workspace.v1\0'
const OUTPUT_ARTIFACT_ID_DOMAIN = 'sciforge.research-checkpoint.output-artifact.v1\0'
const OUTPUT_VERSION_ID_DOMAIN = 'sciforge.research-checkpoint.output-version.v1\0'

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function workspaceBindingDigest(workspaceRoot: string): string {
  return sha256(`${WORKSPACE_BINDING_DOMAIN}${resolve(workspaceRoot)}`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, canonicalValue(record[key])])
  )
}

export function operationId(parts: readonly string[]): string {
  return `research-checkpoint-operation:${sha256(parts.join('\0'))}`
}

export function idempotencyKey(kind: string, parts: readonly string[]): string {
  return `research-checkpoint:${kind}:${sha256(parts.join('\0'))}`
}

export function outputArtifactId(workspaceRoot: string, normalizedPath: string): string {
  return `artifact:research-output:${sha256(
    `${OUTPUT_ARTIFACT_ID_DOMAIN}${workspaceBindingDigest(workspaceRoot)}\0${normalizedPath}`
  )}`
}

export function outputVersionId(operationIdValue: string, normalizedPath: string): string {
  return `artifact-version:research-output:${sha256(
    `${OUTPUT_VERSION_ID_DOMAIN}${operationIdValue}\0${normalizedPath}`
  )}`
}

export function outputCandidateId(operationIdValue: string, normalizedPath: string): string {
  return `output-${sha256(`${operationIdValue}\0${normalizedPath}`).slice(0, 32)}`
}
