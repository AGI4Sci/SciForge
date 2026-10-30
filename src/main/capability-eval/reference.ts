import { capabilityIdSchema } from '../../shared/capability-broker'

export type CapabilityReferenceEntry = Readonly<{
  id: string
  domain: string
  version: string
  audiences: readonly string[]
  effect: string
  approval: string
  scope: string
}>

export type CapabilityReference = Readonly<{
  source: string
  entries: readonly CapabilityReferenceEntry[]
  byId: ReadonlyMap<string, CapabilityReferenceEntry>
}>

/**
 * Reads the generated capability reference, whose source is the application
 * registry composition. This is intentionally a read-only reference for the
 * offline simulator; live runs should provide trace events from the Host.
 */
export function parseCapabilityReferenceMarkdown(
  markdown: string,
  source = 'docs/generated/capabilities.md'
): CapabilityReference {
  const entries: CapabilityReferenceEntry[] = []
  const seen = new Set<string>()
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/u.exec(line.trim())
    if (!match) continue
    const [, id, version, audiences, effect, approval, scope] = match
    const parsedId = capabilityIdSchema.safeParse(id)
    if (!parsedId.success) continue
    if (seen.has(parsedId.data)) {
      throw new Error(`Duplicate capability reference entry: ${parsedId.data}`)
    }
    seen.add(parsedId.data)
    entries.push(Object.freeze({
      id: parsedId.data,
      domain: parsedId.data.split('.')[0] ?? parsedId.data,
      version: version.trim(),
      audiences: Object.freeze(audiences.split(',').map((value) => value.trim()).filter(Boolean)),
      effect: effect.trim(),
      approval: approval.trim(),
      scope: scope.trim()
    }))
  }
  if (entries.length === 0) {
    throw new Error(`Capability reference ${source} does not contain a generated action table.`)
  }
  entries.sort((left, right) => left.id.localeCompare(right.id))
  return Object.freeze({
    source,
    entries: Object.freeze(entries),
    byId: new Map(entries.map((entry) => [entry.id, entry] as const))
  })
}
