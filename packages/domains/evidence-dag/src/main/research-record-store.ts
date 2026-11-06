import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { EvidenceFileStorage } from './secure-storage.js'
import { readResearchRecordState, recordHash, researchRecordStateSchema, type ResearchRecordState } from './research-record-state.js'

const LIMIT = 16
const MAX_SEGMENT_BYTES = 256 * 1024
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const revisionSchema = z.number().int().nonnegative()
const referenceSchema = z.object({ slot: z.number().int().nonnegative(), revision: revisionSchema, digest: digestSchema }).strict()
const manifestSchema = z.object({ format: z.literal('research-record-store-v1'), checkpoint: referenceSchema,
  segments: z.array(referenceSchema).max(LIMIT), revision: revisionSchema, digest: digestSchema }).strict()
const operationSchema = z.object({ path: z.array(z.string()).min(1), op: z.enum(['set', 'delete', 'append']), value: z.unknown().optional() }).strict()
const segmentSchema = z.object({ baseRevision: revisionSchema, baseDigest: digestSchema, revision: revisionSchema,
  digest: digestSchema, operations: z.array(operationSchema) }).strict()
type Manifest = z.infer<typeof manifestSchema>
type Operation = z.infer<typeof operationSchema>
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
}
const digest = (value: unknown) => recordHash(canonical(value))
function difference(before: unknown, after: unknown, path: string[] = [], result: Operation[] = []): Operation[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return result
  if (object(before) && object(after)) {
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) result.push({ op: 'delete', path: [...path, key] })
    for (const key of Object.keys(after)) difference(before[key], after[key], [...path, key], result)
  } else if (Array.isArray(before) && Array.isArray(after) && before.length <= after.length && before.every((value, index) => JSON.stringify(value) === JSON.stringify(after[index]))) {
    result.push({ op: 'append', path, value: after.slice(before.length) })
  } else result.push({ op: 'set', path, value: after })
  return result
}
function apply(state: unknown, operations: Operation[]): void {
  for (const operation of operations) {
    if (operation.path.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Unsafe research record patch path.')
    let parent = state
    for (const key of operation.path.slice(0, -1)) {
      if (!object(parent) || !Object.hasOwn(parent, key)) throw new Error('Invalid research record patch parent.')
      parent = parent[key]
    }
    if (!object(parent)) throw new Error('Invalid research record patch target.')
    const key = operation.path.at(-1)!
    if (operation.op === 'delete') {
      if (!Object.hasOwn(parent, key)) throw new Error('Invalid research record deletion.')
      delete parent[key]
    } else if (operation.op === 'append') {
      if (!Array.isArray(parent[key]) || !Array.isArray(operation.value)) throw new Error('Invalid research record append.')
      parent[key].push(...operation.value)
    } else {
      if (!Object.hasOwn(operation, 'value')) throw new Error('Missing research record patch value.')
      Object.defineProperty(parent, key, { value: operation.value, enumerable: true, writable: true, configurable: true })
    }
  }
}

/** The manifest replacement is the sole commit point. Fixed slots bound derived
 * files: 2 checkpoints and 17 segments. A slot is reused only when the committed
 * manifest no longer references it; every checkpoint retains all research history.
 * Digests detect corruption, not a malicious rewrite of the entire store.
 */
export class ResearchRecordStore {
  private readonly file: EvidenceFileStorage
  private readonly slots = new Map<string, EvidenceFileStorage>()
  private manifest?: Manifest
  private committed?: ResearchRecordState
  private headText?: string
  private loaded = false
  constructor(private readonly path: string, private readonly workspaceRoot: string) { this.file = new EvidenceFileStorage(path) }
  private validateWorkspace(state: ResearchRecordState): void {
    if (resolve(state.workspaceRoot) !== resolve(this.workspaceRoot)) throw new Error('Research record workspace mismatch.')
  }
  private slot(kind: 'checkpoint' | 'segment', slot: number): EvidenceFileStorage {
    const name = `${kind}-${slot}`
    let file = this.slots.get(name)
    if (!file) { file = new EvidenceFileStorage(join(dirname(this.path), `${basename(this.path)}.${name}`)); this.slots.set(name, file) }
    return file
  }
  load(): ResearchRecordState | undefined {
    if (this.loaded) return this.committed && structuredClone(this.committed)
    let text: string
    try { text = this.file.readText() } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A missing head with remaining derived data is not a new workspace.
      for (const kind of ['checkpoint', 'segment'] as const) for (let slot = 0; slot < (kind === 'checkpoint' ? 2 : LIMIT + 1); slot++) {
        try { this.slot(kind, slot).readText() } catch (slotError) {
          if ((slotError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw slotError
        }
        throw new Error('Research record commit manifest is missing; recovery requires inspection.')
      }
      this.loaded = true; return undefined
    }
    const raw: unknown = JSON.parse(text)
    this.headText = text
    if (!object(raw) || raw.format !== 'research-record-store-v1') {
      const { state } = readResearchRecordState(raw)
      this.validateWorkspace(state)
      // One-way migration replaces the legacy file only after its checkpoint is durable.
      this.commitCheckpoint(state)
      this.loaded = true
      return structuredClone(this.committed!)
    }
    const manifest = manifestSchema.parse(raw)
    if (manifest.checkpoint.slot > 1 || manifest.segments.some(ref => ref.slot > LIMIT) || new Set(manifest.segments.map(ref => ref.slot)).size !== manifest.segments.length) throw new Error('Invalid research record slot order.')
    let state = researchRecordStateSchema.parse(JSON.parse(this.slot('checkpoint', manifest.checkpoint.slot).readText()))
    this.validateWorkspace(state)
    let currentDigest = digest(state)
    if (state.revision !== manifest.checkpoint.revision || currentDigest !== manifest.checkpoint.digest) throw new Error('Research record checkpoint integrity mismatch.')
    for (const ref of manifest.segments) {
      const segment = segmentSchema.parse(JSON.parse(this.slot('segment', ref.slot).readText()))
      if (segment.baseRevision !== state.revision || segment.baseDigest !== currentDigest || segment.revision !== state.revision + 1 || segment.revision !== ref.revision || segment.digest !== ref.digest) throw new Error('Research record segment revision/base/order mismatch.')
      apply(state, segment.operations)
      state = researchRecordStateSchema.parse(state)
      this.validateWorkspace(state)
      currentDigest = digest(state)
      if (state.revision !== segment.revision || currentDigest !== segment.digest) throw new Error('Research record segment digest mismatch.')
    }
    if (state.revision !== manifest.revision || currentDigest !== manifest.digest) throw new Error('Research record head integrity mismatch.')
    this.manifest = manifest; this.committed = state; this.loaded = true
    return structuredClone(state)
  }
  private checkHead(): void {
    let actual: string | undefined
    try { actual = this.file.readText() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (actual !== this.headText) throw new Error('Research record commit manifest changed; reload required.')
  }
  private publish(state: ResearchRecordState, manifest: Manifest): void {
    this.checkHead()
    const text = JSON.stringify(manifest)
    this.file.writeText(text)
    this.headText = text; this.manifest = manifest; this.committed = structuredClone(state)
  }
  private commitCheckpoint(state: ResearchRecordState): void {
    this.checkHead()
    const slot = this.manifest?.checkpoint.slot === 0 ? 1 : 0
    this.slot('checkpoint', slot).writeText(JSON.stringify(state))
    const ref = { slot, revision: state.revision, digest: digest(state) }
    this.publish(state, { format: 'research-record-store-v1', checkpoint: ref, segments: [], revision: ref.revision, digest: ref.digest })
  }
  commit(input: ResearchRecordState): void {
    if (!this.loaded) this.load()
    const state = researchRecordStateSchema.parse(JSON.parse(JSON.stringify(input)))
    this.validateWorkspace(state)
    if (this.committed && state.revision !== this.committed.revision + 1) throw new Error('Research record revision must advance exactly once.')
    this.checkHead()
    if (!this.manifest || !this.committed) { this.commitCheckpoint(state); return }
    const segment = { baseRevision: this.committed.revision, baseDigest: this.manifest.digest, revision: state.revision,
      digest: digest(state), operations: difference(this.committed, state) }
    const text = JSON.stringify(segment)
    if (this.manifest.segments.length >= LIMIT || Buffer.byteLength(text) > MAX_SEGMENT_BYTES) { this.commitCheckpoint(state); return }
    const slot = Array.from({ length: LIMIT + 1 }, (_, index) => index).find(index => !this.manifest!.segments.some(ref => ref.slot === index))!
    this.slot('segment', slot).writeText(text)
    this.publish(state, { ...this.manifest, segments: [...this.manifest.segments, { slot, revision: state.revision, digest: segment.digest }], revision: state.revision, digest: segment.digest })
  }
}
