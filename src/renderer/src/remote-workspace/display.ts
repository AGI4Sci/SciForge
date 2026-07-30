import type {
  RemoteWorkspaceEgressRouteView,
  RemoteWorkspaceViewSummary
} from './types'

const WHITESPACE = /\s+/g

function normalizeDisplayText(value: unknown): string {
  return typeof value === 'string'
    ? Array.from(value, (character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
          ? ' '
          : character
      })
        .join('')
        .replace(WHITESPACE, ' ')
        .trim()
    : ''
}

export function sanitizeRemoteWorkspaceDisplayLabel(
  value: unknown,
  fallback: string,
  maxLength = 72
): string {
  const normalized = normalizeDisplayText(value)
  const safeFallback = normalizeDisplayText(fallback)
  if (!normalized) return safeFallback
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function sanitizeRemoteWorkspacePathLabel(
  value: unknown,
  fallback: string,
  maxLength = 96
): string {
  const normalized = normalizeDisplayText(value) || normalizeDisplayText(fallback)
  if (normalized.length <= maxLength) return normalized
  const tailLength = Math.max(1, maxLength - 2)
  return `…/${normalized.slice(-tailLength).replace(/^[/\\]+/, '')}`
}

export function safeRemoteWorkspaceSummary(
  workspace: RemoteWorkspaceViewSummary,
  fallbackLabel: string,
  fallbackPath: string
): RemoteWorkspaceViewSummary {
  return {
    ...workspace,
    displayLabel: sanitizeRemoteWorkspaceDisplayLabel(workspace.displayLabel, fallbackLabel),
    workspacePathLabel: sanitizeRemoteWorkspacePathLabel(
      workspace.workspacePathLabel,
      fallbackPath
    ),
    statusDetail: workspace.statusDetail
      ? sanitizeRemoteWorkspaceDisplayLabel(workspace.statusDetail, '')
      : undefined,
    egressRoutes: workspace.egressRoutes.map(
      (route, index): RemoteWorkspaceEgressRouteView => ({
        ...route,
        displayLabel: sanitizeRemoteWorkspaceDisplayLabel(
          route.displayLabel,
          `${fallbackLabel} ${index + 1}`
        )
      })
    )
  }
}
