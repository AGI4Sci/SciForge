/**
 * SDD trace layer: connects structured requirement blocks in requirement.md
 * with plan steps carrying `(covers: R-1, R-2)` tags.
 */

export const SDD_REQUIREMENT_STATUSES = [
  'draft',
  'planned',
  'building',
  'done',
  'verified'
] as const

export type SddRequirementStatus = (typeof SDD_REQUIREMENT_STATUSES)[number]

export type SddAcceptanceItem = {
  text: string
  checked: boolean
  lineIndex: number
}

export type SddRequirementBlock = {
  id: string
  title: string
  status: SddRequirementStatus
  headingLevel: number
  headingLineIndex: number
  endLineIndex: number
  acceptance: SddAcceptanceItem[]
  contentHash: string
}

export type SddPlanCoverageItem = {
  requirementIds: string[]
  text: string
  rawText: string
  checked: boolean
  lineIndex: number
}

export type SddRequirementCoverage = {
  id: string
  totalSteps: number
  doneSteps: number
}

const HEADING_RE = /^(#{2,4})\s+(R-\d+)\s*[:：]\s*(.+?)\s*$/
const STATUS_TOKEN_RE = /\{\s*(draft|planned|building|done|verified)\s*\}\s*$/i
const TASK_LINE_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/
const COVERS_RE = /[（(]\s*covers\s*[:：]\s*([Rr]-\d+(?:\s*[,，、]\s*[Rr]-\d+)*)\s*[)）]/

export function isSddRequirementStatus(value: string): value is SddRequirementStatus {
  return (SDD_REQUIREMENT_STATUSES as readonly string[]).includes(value)
}

function hashText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase()
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function splitHeading(text: string): { title: string; status: SddRequirementStatus } {
  const statusMatch = STATUS_TOKEN_RE.exec(text)
  if (!statusMatch) return { title: text.trim(), status: 'draft' }
  return {
    title: text.slice(0, statusMatch.index).trim(),
    status: statusMatch[1].toLowerCase() as SddRequirementStatus
  }
}

export function parseSddRequirementBlocks(markdown: string): SddRequirementBlock[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: SddRequirementBlock[] = []
  let current: (Omit<SddRequirementBlock, 'endLineIndex' | 'contentHash'> & {
    bodyLines: string[]
  }) | null = null
  let insideFence = false

  const finalize = (endLineIndex: number): void => {
    if (!current) return
    blocks.push({
      id: current.id,
      title: current.title,
      status: current.status,
      headingLevel: current.headingLevel,
      headingLineIndex: current.headingLineIndex,
      endLineIndex,
      acceptance: current.acceptance,
      contentHash: hashText(`${current.title}\n${current.bodyLines.join('\n')}`)
    })
    current = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) insideFence = !insideFence
    if (insideFence) {
      current?.bodyLines.push(line)
      continue
    }

    const headingMatch = /^(#{1,6})\s/.exec(line)
    if (headingMatch) {
      const level = headingMatch[1].length
      const requirementMatch = HEADING_RE.exec(line)
      if (current && level <= current.headingLevel) finalize(index)
      if (requirementMatch) {
        const { title, status } = splitHeading(requirementMatch[3])
        current = {
          id: requirementMatch[2].toUpperCase(),
          title,
          status,
          headingLevel: requirementMatch[1].length,
          headingLineIndex: index,
          acceptance: [],
          bodyLines: []
        }
      }
      continue
    }

    if (!current) continue
    current.bodyLines.push(line)
    const task = TASK_LINE_RE.exec(line)
    if (task) {
      current.acceptance.push({
        text: task[2].trim(),
        checked: task[1] !== ' ',
        lineIndex: index
      })
    }
  }
  finalize(lines.length)
  return blocks
}

export function setSddRequirementStatus(
  markdown: string,
  id: string,
  status: SddRequirementStatus
): string {
  const lines = markdown.split(/\r?\n/)
  const blocks = parseSddRequirementBlocks(markdown)
  const block = blocks.find((candidate) => candidate.id === id.toUpperCase())
  if (!block || block.status === status) return markdown

  const line = lines[block.headingLineIndex]
  const headingMatch = HEADING_RE.exec(line)
  if (!headingMatch) return markdown
  const { title } = splitHeading(headingMatch[3])
  lines[block.headingLineIndex] = `${headingMatch[1]} ${block.id}: ${title} {${status}}`
  return lines.join('\n')
}

export function parseSddPlanCovers(planMarkdown: string): SddPlanCoverageItem[] {
  const items: SddPlanCoverageItem[] = []
  const lines = planMarkdown.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const task = TASK_LINE_RE.exec(lines[index])
    if (!task) continue
    const covers = COVERS_RE.exec(task[2])
    if (!covers) continue
    const requirementIds = covers[1]
      .split(/[,，、]/)
      .map((value) => value.trim().toUpperCase())
      .filter((value) => /^R-\d+$/.test(value))
    if (requirementIds.length === 0) continue
    items.push({
      requirementIds,
      text: task[2].replace(COVERS_RE, '').trim(),
      rawText: task[2].trim(),
      checked: task[1] !== ' ',
      lineIndex: index
    })
  }
  return items
}

export function computeSddCoverage(
  blocks: SddRequirementBlock[],
  planItems: SddPlanCoverageItem[]
): { perRequirement: SddRequirementCoverage[]; uncoveredIds: string[] } {
  const perRequirement = blocks.map((block) => {
    const related = planItems.filter((item) => item.requirementIds.includes(block.id))
    return {
      id: block.id,
      totalSteps: related.length,
      doneSteps: related.filter((item) => item.checked).length
    }
  })
  return {
    perRequirement,
    uncoveredIds: perRequirement.filter((entry) => entry.totalSteps === 0).map((entry) => entry.id)
  }
}

const STATUS_RANK: Record<SddRequirementStatus, number> = {
  draft: 0,
  planned: 1,
  building: 2,
  done: 3,
  verified: 4
}

export function deriveSddStatuses(
  blocks: SddRequirementBlock[],
  coverage: SddRequirementCoverage[]
): Record<string, SddRequirementStatus> {
  const derived: Record<string, SddRequirementStatus> = {}
  for (const block of blocks) {
    const entry = coverage.find((candidate) => candidate.id === block.id)
    if (!entry || entry.totalSteps === 0) continue
    const next: SddRequirementStatus =
      entry.doneSteps === entry.totalSteps
        ? 'done'
        : entry.doneSteps > 0
          ? 'building'
          : 'planned'
    if (STATUS_RANK[next] > STATUS_RANK[block.status]) derived[block.id] = next
  }
  return derived
}

export function applySddDerivedStatuses(
  markdown: string,
  derived: Record<string, SddRequirementStatus>
): string {
  let next = markdown
  for (const [id, status] of Object.entries(derived)) {
    next = setSddRequirementStatus(next, id, status)
  }
  return next
}

export type SddTraceSnapshot = {
  requirementHashes: Record<string, string>
  planRelativePath: string
  capturedAt: string
}

export function buildSddTraceSnapshot(
  markdown: string,
  planRelativePath: string,
  now = new Date()
): SddTraceSnapshot {
  const hashes: Record<string, string> = {}
  for (const block of parseSddRequirementBlocks(markdown)) {
    hashes[block.id] = block.contentHash
  }
  return {
    requirementHashes: hashes,
    planRelativePath,
    capturedAt: now.toISOString()
  }
}

export function diffSddRequirementChanges(
  markdown: string,
  snapshot: SddTraceSnapshot
): { changedIds: string[]; addedIds: string[] } {
  const changedIds: string[] = []
  const addedIds: string[] = []
  for (const block of parseSddRequirementBlocks(markdown)) {
    const previous = snapshot.requirementHashes[block.id]
    if (previous === undefined) addedIds.push(block.id)
    else if (previous !== block.contentHash) changedIds.push(block.id)
  }
  return { changedIds, addedIds }
}
