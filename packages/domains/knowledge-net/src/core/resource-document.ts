import type { SealedResource } from '../resource-contract.js'

/** Full snapshot accompanies human-readable summary so no evidence or qualifier is lost. */
export function renderResourceDocument(item: SealedResource, format: 'markdown' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(item, null, 2)}\n`
  const { resource } = item
  const lines = [`# ${resource.name}`, '', resource.description, '',
    `- Resource: ${item.resourceId}`, `- Version: ${item.versionId}`, `- SHA-256: ${item.contentDigest}`,
    `- Sealed at: ${item.sealedAt}`, `- Data types: ${resource.dataTypes.join(', ')}`,
    `- Processing: ${resource.processingLevel}`, `- Access: ${resource.access.mode}`,
    `- Conditions: ${resource.access.details ?? 'Not recorded'}`, `- License: ${resource.license?.name ?? 'unknown'}`, '',
    '## Verification observations', '']
  if (!resource.checks.length) lines.push('No verification observations recorded.', '')
  for (const check of resource.checks) lines.push(`- ${check.kind}: ${check.outcome} (${check.observedAt}); evidence: ${check.evidenceIds.join(', ')}${check.detail ? `; ${check.detail}` : ''}`)
  lines.push('', '## Evidence', '')
  for (const evidence of resource.evidence) lines.push(`- ${evidence.evidenceId}: ${evidence.quote}`, `  Source: ${evidence.url ?? evidence.paperId}; observed: ${evidence.observedAt}; self-reported actor: ${evidence.actorLabel}`)
  lines.push('', '## Complete sealed resource', '', '```json', JSON.stringify(item, null, 2), '```', '')
  return lines.join('\n')
}
