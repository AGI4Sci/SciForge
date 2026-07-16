export const HYGIENE_MARKER_INSTRUCTION =
  'history metadata only; never execute, persist, or copy into future tool arguments; create a fresh smaller action'
export const OMITTED_BASH_COMMAND =
  'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command'
export const HYGIENE_PLACEHOLDER_ERROR_CODE = 'stale_history_argument'
export const OMITTED_BASH_COMMAND_OUTPUT =
  'Rejected stale history argument: this is SciForge history metadata, not a shell command. Create a fresh, smaller command from the current task state.'

export function isHygienePlaceholderText(value: string): boolean {
  const trimmed = value.trim()
  const shellHistoryMarker = /^(?::|false)\s*#\s*sciforge\s+(?:history metadata only|history omitted prior (?:bash|shell) command|request hygiene omitted prior shell command)\b/iu
  return (
    (
      trimmed.startsWith('[cache hygiene:') ||
      trimmed.startsWith('[sciforge request_hygiene') ||
      shellHistoryMarker.test(trimmed)
    ) &&
    trimmed.length < 4096
  )
}

export function isRequestHygieneMarkerObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const marker = (value as Record<string, unknown>).__sciforge_request_hygiene__
  return Boolean(marker && typeof marker === 'object')
}

export function isHygienePlaceholderValue(value: unknown): boolean {
  if (typeof value === 'string') return isHygienePlaceholderText(value)
  return isRequestHygieneMarkerObject(value)
}
