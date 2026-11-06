import path from 'node:path'
import type { AgentRuntimeFileReference } from '../../../shared/agent-runtime-contract'

export function workspaceReferencePrompt(
  text: string,
  fileReferences: AgentRuntimeFileReference[] | undefined
): string {
  const seen = new Set<string>()
  const references: Array<{ path: string; kind?: AgentRuntimeFileReference['kind'] }> = []
  for (const reference of fileReferences ?? []) {
    const relativePath = safeWorkspaceRelativePath(reference.relativePath)
    if (!relativePath) {
      throw new Error('Workspace reference path must be workspace-relative.')
    }
    if (seen.has(relativePath)) continue
    seen.add(relativePath)
    references.push({
      path: relativePath,
      ...(reference.kind ? { kind: reference.kind } : {})
    })
  }
  if (references.length === 0) return text
  return [
    text,
    '',
    '<workspace_references>',
    'These are workspace-relative path references. Their contents are not embedded; inspect them on demand with workspace tools.',
    ...references.map((reference) =>
      JSON.stringify(reference).replace(/[<>&]/gu, (character) => {
        if (character === '<') return '\\u003c'
        if (character === '>') return '\\u003e'
        return '\\u0026'
      })
    ),
    '</workspace_references>'
  ].join('\n')
}

function safeWorkspaceRelativePath(value: string): string | null {
  const candidate = value.trim().replaceAll('\\', '/')
  if (!candidate || candidate.includes('\0')) return null
  if (candidate.startsWith('/') || /^[a-z]:/iu.test(candidate)) return null
  if (/^[a-z][a-z0-9+.-]*:/iu.test(candidate)) return null
  const normalized = path.posix.normalize(candidate)
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return null
  }
  return normalized
}
