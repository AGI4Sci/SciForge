import { join } from 'node:path'
import { z } from 'zod'
import { researchRecordSourceSchema } from '../research-record-contract.js'
import { researchSourceDigest } from './research-record-ingestion.js'
import { recordHash } from './research-record-state.js'
import { EvidenceFileStorage } from './secure-storage.js'

/** Visible observations only, never scientific Artifacts. Quota counts source
 * JSON bytes (manifest/lock overhead is separately bounded). The source ledger
 * preserves reservations across restart; record references remain authoritative.
 * Never evict audit references. A stale writer lock requires explicit inspection. */
export class ResearchSourceStore {
  static readonly maxBytes = 2 * 1024 * 1024
  static readonly maxTotalBytes = 64 * 1024 * 1024
  static readonly maxEntries = 2048
  private readonly manifest: EvidenceFileStorage
  constructor(private readonly directory: string, private readonly limits = { maxBytes: ResearchSourceStore.maxTotalBytes, maxEntries: ResearchSourceStore.maxEntries }) {
    if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || !Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1 || limits.maxEntries > ResearchSourceStore.maxEntries) throw new Error('Invalid source retention capacity.')
    this.manifest = new EvidenceFileStorage(join(directory, 'research-source-manifest.json'))
  }
  private loadManifest(): Manifest {
    let text: string
    try { text = this.manifest.readText(4 * 1024 * 1024) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // Legacy bytes count towards the quota. Inventory never follows links.
      const entries: Manifest['entries'] = {}
      const files = this.manifest.inventory('research-source-').filter(row => /^research-source-[a-f0-9]{64}\.json$/.test(row.name))
      if (files.length > this.limits.maxEntries) throw new Error('Legacy source inventory exceeds capacity; explicit export/migration required.')
      for (const row of files) entries[row.name.slice(16, -5)] = { bytes: row.bytes, status: 'retained' }
      return { version: 1, entries, rejectedEntries: 0, rejectedKeys: [], rejectionCoverageBounded: false }
    }
    const manifest = manifestSchema.parse(JSON.parse(text))
    const present = new Set<string>()
    for (const row of this.manifest.inventory('research-source-')) {
      if (!/^research-source-[a-f0-9]{64}\.json$/.test(row.name)) continue
      const key = row.name.slice(16, -5)
      present.add(key)
      const entry = manifest.entries[key]
      if (!entry || entry.bytes !== row.bytes) throw new Error('Source inventory corrupt or differs from manifest; explicit inspection required.')
    }
    for (const [key, entry] of Object.entries(manifest.entries)) if (entry.status === 'retained' && !present.has(key)) throw new Error('Manifest source missing; explicit inspection required.')
    return manifest
  }
  private saveManifest(value: Manifest) { this.manifest.writeText(JSON.stringify(manifestSchema.parse(value))) }
  /** Coverage is explicitly bounded to supplied owner references; never a claim
   * of full Session or scientific provenance coverage. Ref bytes are verified. */
  coverage(refs: readonly unknown[]) {
    const reasons: string[] = []
    let usageKnown = false
    let usedBytes = 0, retainedEntries = 0, reservedEntries = 0, rejectedEntries = 0, missingEntries = 0, corruptEntries = 0
    try {
      const manifest = this.loadManifest()
      if (this.manifest.hasExclusiveLock()) reasons.push('retention-writer-lock-present; inspect if interrupted')
      usageKnown = true
      reservedEntries = Object.values(manifest.entries).filter(entry => entry.status === 'reserved').length
      if (reservedEntries) reasons.push('source-write-incomplete')
      usedBytes = Object.values(manifest.entries).reduce((sum, entry) => sum + entry.bytes, 0)
      retainedEntries = Object.values(manifest.entries).filter(entry => entry.status === 'retained').length
      rejectedEntries = manifest.rejectedEntries
      if (usedBytes > this.limits.maxBytes || Object.keys(manifest.entries).length > this.limits.maxEntries) reasons.push('capacity-exceeded; explicit export/migration required')
      if (rejectedEntries) reasons.push('retention-rejected')
      if (manifest.rejectionCoverageBounded) reasons.push('rejection-entry-count-bounded')
    } catch { reasons.push('manifest-unavailable-or-corrupt') }
    const inspected = refs.slice(0, 32)
    for (const ref of inspected) {
      const result = this.read(ref)
      if (result.status === 'not-retained') missingEntries++
      if (result.status === 'corrupt') corruptEntries++
    }
    if (missingEntries) reasons.push('referenced-source-missing')
    if (corruptEntries) reasons.push('referenced-source-corrupt')
    if (inspected.length < refs.length) reasons.push('source-verification-bounded')
    return { usageKnown, maxBytes: this.limits.maxBytes, usedBytes, maxEntries: this.limits.maxEntries, retainedEntries, reservedEntries, missingEntries, corruptEntries, rejectedEntries,
      complete: !reasons.length, reasons, policy: 'retain-referenced-no-auto-delete' as const, exportRequired: reasons.length > 0,
      referencedEntries: refs.length, inspectedEntries: inspected.length }
  }
  private file(ref: unknown) {
    const value = researchRecordSourceSchema.parse(ref)
    return new EvidenceFileStorage(join(this.directory, `research-source-${recordHash(value)}.json`))
  }
  read(ref: unknown): { status: 'retained' | 'not-retained' | 'corrupt'; raw?: unknown } {
    try {
      const manifest = this.loadManifest(), parsed = researchRecordSourceSchema.parse(ref)
      const entry = manifest.entries[recordHash(parsed)]
      const text = this.file(ref).readText(ResearchSourceStore.maxBytes)
      if (!entry || entry.status !== 'retained' || Buffer.byteLength(text) !== entry.bytes) return { status: 'corrupt' }
      const value = JSON.parse(text)
      if (researchSourceDigest(value) !== researchRecordSourceSchema.parse(ref).digest) return { status: 'corrupt' }
      return { status: 'retained', raw: value }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'not-retained' }
      return { status: 'corrupt' }
    }
  }
  retain(ref: unknown, raw: unknown): boolean {
    const value = researchRecordSourceSchema.parse(ref)
    if (researchSourceDigest(raw) !== value.digest) throw new Error('Research source digest mismatch.')
    const text = JSON.stringify(raw)
    const bytes = Buffer.byteLength(text)
    return this.manifest.withExclusiveLock(() => {
      const manifest = this.loadManifest(), key = recordHash(value)
      const prior = this.read(value)
      if (prior.status === 'corrupt') throw new Error('Retained research source corrupt; inspection required.')
      if (prior.status === 'retained') return true
      const used = Object.values(manifest.entries).reduce((sum, entry) => sum + entry.bytes, 0)
      if (bytes > ResearchSourceStore.maxBytes || used + Math.max(0, bytes - (manifest.entries[key]?.bytes ?? 0)) > this.limits.maxBytes || !manifest.entries[key] && Object.keys(manifest.entries).length >= this.limits.maxEntries) {
        if (!manifest.rejectedKeys.includes(key)) {
          if (manifest.rejectedKeys.length < ResearchSourceStore.maxEntries) manifest.rejectedKeys.push(key)
          else manifest.rejectionCoverageBounded = true
        }
        manifest.rejectedEntries = Math.max(manifest.rejectedEntries, manifest.rejectedKeys.length)
        this.saveManifest(manifest)
        return false
      }
      // Reserve durably before bytes. An interrupted write remains an explicit
      // missing reference and consumes capacity until manual owner migration.
      manifest.entries[key] = { bytes: Math.max(bytes, manifest.entries[key]?.bytes ?? 0), status: 'reserved' }
      this.saveManifest(manifest)
      this.file(value).writeText(text)
      manifest.entries[key].status = 'retained'
      this.saveManifest(manifest)
      return true
    })
  }
}

const manifestSchema = z.object({ version: z.literal(1),
  entries: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({ bytes: z.number().int().nonnegative(), status: z.enum(['reserved', 'retained']) }).strict()),
  rejectedEntries: z.number().int().nonnegative(),
  rejectedKeys: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(ResearchSourceStore.maxEntries).default([]),
  rejectionCoverageBounded: z.boolean().default(false)
}).strict().refine(value => Object.keys(value.entries).length <= ResearchSourceStore.maxEntries)
type Manifest = z.infer<typeof manifestSchema>
