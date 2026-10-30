export const SDD_RELATIVE_DIR = '.sciforge/sdd'
/**
 * One requirement = one self-contained directory:
 * `.sciforge/sdd/requirements/<uuid>/{requirement.md, trace.json, img/}`.
 */
export const SDD_REQUIREMENTS_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/requirements`
export const SDD_IMAGE_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/img`
export const SDD_DRAFT_FILE_NAME = 'requirement.md'
export const SDD_TRACE_FILE_NAME = 'trace.json'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeSddRelativePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function buildSddDraftRelativePath(id: string): string {
  return `${SDD_REQUIREMENTS_RELATIVE_DIR}/${id}/${SDD_DRAFT_FILE_NAME}`
}

export function isSddDraftRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  return isCurrentSddDraftParts(parts)
}

export function sddDraftFolderFromRelativePath(value: string): string | null {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  if (isCurrentSddDraftParts(parts)) return parts.at(-2) ?? null
  return null
}

export function sddRequirementUnitDir(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  if (!folder) return null
  return `${SDD_REQUIREMENTS_RELATIVE_DIR}/${folder}`
}

export function sddUnitImageDir(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  if (!folder) return null
  return `${SDD_REQUIREMENTS_RELATIVE_DIR}/${folder}/img`
}

export function sddDraftTraceRelativePath(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  if (!unit) return null
  return `${unit}/${SDD_TRACE_FILE_NAME}`
}

export function sddDraftRelativePathForPlanPath(planRelativePath: string): string | null {
  const normalized = normalizeSddRelativePath(planRelativePath)
  const currentMatch = /^\.sciforge\/plan\/sdd-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?\.md$/i.exec(normalized)
  if (currentMatch) return buildSddDraftRelativePath(currentMatch[1].toLowerCase())
  return null
}

export function isSddImageRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const currentMatch = /^\.sciforge\/sdd\/requirements\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/img\/(.+)$/i.exec(normalized)
  if (currentMatch) return isSafeNestedRelativePath(currentMatch[2] ?? '')
  return false
}

function isSafeNestedRelativePath(rest: string): boolean {
  return Boolean(rest) && !rest.split('/').some((part) => !part || part === '.' || part === '..')
}

function isCurrentSddDraftParts(parts: string[]): boolean {
  return (
    parts.length === 5 &&
    parts[0] === '.sciforge' &&
    parts[1] === 'sdd' &&
    parts[2] === 'requirements' &&
    UUID_LIKE.test(parts[3] ?? '') &&
    parts[4] === SDD_DRAFT_FILE_NAME
  )
}
