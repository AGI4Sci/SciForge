export type DiffStats = Readonly<{
  added: number
  removed: number
}>

export function countDiffStats(patch: string): DiffStats {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

export function extractDiffFilePath(patch: string, override?: string): string | undefined {
  const preset = override?.trim()
  if (preset) return preset
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const candidate = line.slice(4).trim().replace(/^[ab]\//, '')
      if (candidate && candidate !== '/dev/null') return candidate
    }
    if (line.startsWith('diff --git ')) {
      const match = line.match(/ b\/(\S+)/)
      if (match?.[1]) return match[1]
    }
  }
  return undefined
}

export function formatFilePath(filePath: string | undefined, workspaceRoot?: string): string | undefined {
  const normalizedPath = filePath?.trim().replace(/\\/g, '/')
  const normalizedRoot = workspaceRoot?.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedPath || !normalizedRoot) return normalizedPath
  return normalizedPath.toLocaleLowerCase().startsWith(`${normalizedRoot.toLocaleLowerCase()}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath
}
