function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function workspaceRootIdentityKey(path?: string): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  const portablePath = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalized = /^[a-z]:(?:\/|$)/i.test(portablePath) || portablePath.startsWith('//')
    ? portablePath.toLowerCase()
    : portablePath
  if (
    normalized === '~/.sciforge/default_workspace'
    || normalized.endsWith('/.sciforge/default_workspace')
  ) {
    return '~/.sciforge/default_workspace'
  }
  return normalized
}

export function isInternalTemporaryWorkspace(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return (
    /\/deepseek-tui-updates\/tmp(?:\/|$)/.test(normalized)
    || normalized === '/tmp'
    || normalized.startsWith('/tmp/')
    || normalized === '/private/tmp'
    || normalized.startsWith('/private/tmp/')
    || /^\/var\/folders\/[^/]+\/[^/]+\/t(?:\/|$)/.test(normalized)
    || /^\/private\/var\/folders\/[^/]+\/[^/]+\/t(?:\/|$)/.test(normalized)
    || /\/appdata\/local\/temp(?:\/|$)/.test(normalized)
  )
}

export function isInternalSciForgeWorkspace(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return (
    normalized === '~/.sciforge/write_workspace'
    || normalized.endsWith('/.sciforge/write_workspace')
  )
}

export function normalizeWorkspaceRoot(path?: string): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  if (isInternalTemporaryWorkspace(trimmed)) return ''
  return trimmed
}
