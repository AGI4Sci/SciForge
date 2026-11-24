import type { KnowledgeRecord } from '../contract.js'
import type { SealedResource } from '../resource-contract.js'
import { renderResourceDocument } from './resource-document.js'

/**
 * Renders one paper's accumulated knowledge as a document. All records for the
 * paper are folded together: concepts deduplicate by term (first observed wins,
 * matching derivation order), reading targets deduplicate by term, and every
 * 4-layer note is kept. Deterministic, derived only from sealed records.
 */

export type KnowledgeDocumentFormat = 'markdown' | 'json'

type ConceptEntry = NonNullable<KnowledgeRecord['concepts']>[number]
type TargetEntry = NonNullable<KnowledgeRecord['conceptTargets']>[number]

function dedupeByTerm<T extends { term: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.term)) return false
    seen.add(entry.term)
    return true
  })
}

export type KnowledgeDocumentModel = Readonly<{
  paperId: string
  title: string
  concepts: readonly ConceptEntry[]
  targets: readonly TargetEntry[]
  notes: readonly Readonly<{ paperId: string; note: NonNullable<KnowledgeRecord['note']> }>[]
  resources: readonly SealedResource[]
}>

export function buildKnowledgeDocument(records: readonly KnowledgeRecord[], paperId: string, resources: readonly SealedResource[] = []): KnowledgeDocumentModel {
  const paperRecords = records.filter((record) => record.paperId === paperId)
  const title = paperRecords.find((record) => record.title)?.title ?? paperId
  return {
    paperId,
    title,
    resources: resources.filter((item) => item.resource.paperLinks.some((link) => link.paperId === paperId)).sort((a, b) => a.resourceId.localeCompare(b.resourceId)),
    concepts: dedupeByTerm(paperRecords.flatMap((record) => record.concepts)),
    targets: dedupeByTerm(paperRecords.flatMap((record) => record.conceptTargets)),
    notes: paperRecords
      .filter((record) => record.note !== undefined)
      .map((record) => ({ paperId: record.paperId, note: record.note! }))
  }
}

function markdown(model: KnowledgeDocumentModel): string {
  const lines = [`# ${model.title}`, '']

  lines.push('## Concepts', '')
  for (const concept of model.concepts) {
    lines.push(`### ${concept.term}`, '')
    lines.push(concept.definition, '')
    if (concept.provenance?.quote) lines.push(`> Quote: "${concept.provenance.quote}"`, '')
    if (concept.contrastWith) lines.push(`- Contrasts with: ${concept.contrastWith}`)
    if (concept.analogy) lines.push(`- Analogy: ${concept.analogy}`)
    if (concept.subConcept) lines.push(`- Sub-concept: **${concept.subConcept.term}** — ${concept.subConcept.definition}`)
    lines.push('')
  }

  lines.push('## Reading targets', '')
  if (model.targets.length === 0) lines.push('_None._', '')
  for (const target of model.targets) lines.push(`- ${target.term}`)
  lines.push('')

  lines.push('## Notes', '')
  if (model.notes.length === 0) lines.push('_None._', '')
  for (const { note } of model.notes) {
    lines.push(`**Definition**: ${note.definition}`, '')
    lines.push(`**Role in paper**: ${note.roleInPaper}`, '')
    const relation = note.argumentativeRelation.detail
      ? `${note.argumentativeRelation.relation} — ${note.argumentativeRelation.detail}`
      : note.argumentativeRelation.relation
    lines.push(`**Argumentative relation**: ${relation}`, '')
    lines.push(`**Critical extension**: ${note.criticalExtension}`, '')
  }

  lines.push('## Data resources', '')
  for (const item of model.resources) lines.push(renderResourceDocument(item, 'markdown').replace(/^#/gm, '##'))
  return `${lines.join('\n').trimEnd()}\n`
}

export function renderKnowledgeDocument(
  records: readonly KnowledgeRecord[],
  paperId: string,
  format: KnowledgeDocumentFormat,
  resources: readonly SealedResource[] = []
): string {
  const model = buildKnowledgeDocument(records, paperId, resources)
  if (format === 'json') return `${JSON.stringify(model, null, 2)}\n`
  return markdown(model)
}
