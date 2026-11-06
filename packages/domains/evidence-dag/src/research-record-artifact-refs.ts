import { artifactVersionRefV1Schema, type ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'

/** Only complete, typed version references. Never resolve a filename or fetch an output URL. */
export function recordArtifactReferences(raw: unknown) {
  const refs: ArtifactVersionRefV1[] = [], seen = new Set<string>(), visited = new Set<object>()
  let scanned = 0, limited = false
  const visit = (value: unknown, depth: number): void => {
    if (++scanned > 256 || depth > 7) { limited = true; return }
    if (typeof value === 'string') {
      if (['[', '{'].includes(value.trimStart()[0])) { if (value.length > 65536) limited = true; else { try { visit(JSON.parse(value), depth + 1) } catch { /* Plain text stays at its source. */ } } }
      return
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    const parsed = artifactVersionRefV1Schema.safeParse(value)
    if (parsed.success && true) {
      const key = `${parsed.data.artifactId}:${parsed.data.versionId}:${parsed.data.contentDigest}`
      if (!seen.has(key)) { if (refs.length >= 8) { limited = true; return }; seen.add(key); refs.push(parsed.data) }
      return
    }
    for (const entry of Object.values(value)) { if (scanned >= 256) { limited = true; break }; visit(entry, depth + 1) }
  }
  visit(raw, 0)
  return { refs, limited }
}
