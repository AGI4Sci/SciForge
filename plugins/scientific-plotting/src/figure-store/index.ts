import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'

/** All IO, including parent creation, existence checks and atomic staging IO, belongs to this port.
 * The native adapter MUST authorize every IO and reject escaping paths/symlinks. read returns null
 * only for ENOENT. Immutable writes are exclusive; atomic writes replace a whole file atomically.
 * Paths passed to the port are relative to the authorized workspace, never external source paths.
 */
export interface FigureFileSystem {
  /** Required when multiple processes can write. Lock must span callback, including every IO.
   * key is a document ID or @index. Never hold it across user confirmation. */
  withLock?<T>(workspaceRoot: string, key: string, run: () => Promise<T>): Promise<T>
  read(workspaceRoot: string, relativePath: string): Promise<Uint8Array | null>
  listDirectories(workspaceRoot: string, relativePath: string): Promise<string[]>
  writeImmutable(workspaceRoot: string, relativePath: string, bytes: Uint8Array): Promise<void>
  writeAtomic(workspaceRoot: string, relativePath: string, bytes: Uint8Array): Promise<void>
}

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const counter = z.number().int().nonnegative().safe()
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()
const bounds = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict()
  .refine(b => b.x + b.width <= 1 && b.y + b.height <= 1, 'Box must fit normalized canvas')
/** Mirrors origin/main review/types.ts geometry, without its retired artifact-version dependency. */
export const annotationGeometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), bounds }).strict(),
  z.object({ kind: z.literal('pin'), point }).strict(),
  z.object({ kind: z.literal('arrow'), from: point, to: point }).strict(),
  z.object({ kind: z.literal('freehand'), points: z.array(point).min(2) }).strict()
])
export const annotationSchema = z.object({
  id, kind: z.enum(['box', 'pin', 'arrow', 'freehand']), geometry: annotationGeometrySchema,
  instruction: z.string().trim().min(1), targetNodeIds: z.array(id), status: z.enum(['open', 'resolved']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime()
}).strict().refine(a => a.kind === a.geometry.kind, 'Annotation kind and geometry disagree')
export type FigureAnnotation = z.infer<typeof annotationSchema>

function absolutePath(value: string): boolean {
  return /^(?:[/\\]|[A-Za-z]:|file:)/i.test(value)
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export const sourceJsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string().refine(s => !absolutePath(s), 'Absolute paths are forbidden'),
  z.array(sourceJsonSchema), z.record(z.string().refine(s => !absolutePath(s)), sourceJsonSchema)
]))
export const generationSchema = z.object({ generationId: id, recipe: sourceJsonSchema, code: z.string(), inputs: sourceJsonSchema }).strict()
export type FigureGeneration = z.infer<typeof generationSchema>
const relativePath = z.string().refine(p => !absolutePath(p) && !p.includes('\\') && p.split('/').every(s => s && s !== '.' && s !== '..'), 'Expected safe relative path')
const fileRef = z.object({ path: relativePath, sha256: hash, byteLength: counter }).strict()
export const executionLinkSchema = z.object({ codeRevisionId: id, runId: id, run: fileRef, output: fileRef }).strict()
export type FigureExecutionLink = z.infer<typeof executionLinkSchema>
/** A supplied image is associated with frozen code, without claiming the code produced it. */
export const sourceCodeSchema = z.object({ codeRevisionId: id, code: fileRef, provenance: z.literal('supplied'), verification: z.literal('unverified') }).strict()
export type FigureSourceCode = z.infer<typeof sourceCodeSchema>
export const revisionSchema = z.object({
  revisionId: id, image: fileRef, originalFilename: z.string().min(1), format: z.string().regex(/^[a-z0-9]+$/),
  baseline: z.object({ revisionId: id, sha256: hash }).strict().nullable(),
  generation: z.object({ generationId: id, recipe: fileRef, code: fileRef, inputs: fileRef }).strict().optional(),
  execution: executionLinkSchema.optional(),
  sourceCode: sourceCodeSchema.optional()
}).strict()
export type FigureRevision = z.infer<typeof revisionSchema>
const resultSchema = z.object({
  documentId: id, documentRevision: counter, status: z.enum(['created', 'candidate_added', 'annotations_saved', 'accepted', 'rejected', 'cancelled']),
  revisionId: id.optional(), currentRevisionId: id
}).strict()
export type FigureOperationResult = z.infer<typeof resultSchema>
export const documentSchema = z.object({
  schemaVersion: z.literal(1), documentId: id, documentRevision: counter,
  originalRevisionId: id, currentRevisionId: id,
  revisions: z.array(z.object({ metadata: revisionSchema, status: z.enum(['original', 'candidate', 'accepted', 'rejected', 'cancelled']) }).strict()).min(1),
  annotations: z.array(annotationSchema),
  acceptances: z.array(z.object({ operationId: id, revisionId: id, previousRevisionId: id, confirmationId: id, documentRevision: counter }).strict()),
  operations: z.array(z.object({ operationId: id, inputHash: hash, requestKey: hash.optional(), result: resultSchema }).strict())
}).strict()
export type FigureDocument = z.infer<typeof documentSchema>
const indexSchema = z.object({ schemaVersion: z.literal(1), documents: z.array(z.object({ documentId: id, path: relativePath }).strict()) }).strict()
const imageSchema = z.object({ revisionId: id, originalFilename: z.string().regex(/^[^/\\]+\.[A-Za-z0-9]+$/), bytes: z.instanceof(Uint8Array).refine(b => b.byteLength > 0, 'Empty image') }).strict()
export type FigureImage = z.infer<typeof imageSchema>
const baseSchema = z.object({ documentId: id, operationId: id, expectedDocumentRevision: counter }).strict()
export type FigureMutation = z.infer<typeof baseSchema>
const createSchema = baseSchema.extend({ image: imageSchema, generation: generationSchema.optional(), execution: executionLinkSchema.optional(), sourceCode: sourceCodeSchema.optional(), requestKey: hash.optional() }).strict()
const candidateSchema = createSchema.extend({ baselineRevisionId: id, baselineHash: hash }).strict()
const annotationsSchema = baseSchema.extend({ annotations: z.array(annotationSchema) }).strict()
const decisionSchema = baseSchema.extend({ revisionId: id }).strict()
export type CreateFigureInput = z.infer<typeof createSchema>
export type AddCandidateInput = z.infer<typeof candidateSchema>
export type SaveAnnotationsInput = z.infer<typeof annotationsSchema>
export type DecideCandidateInput = z.infer<typeof decisionSchema>
export type FigureConfirmation = (request: {
  documentId: string; operationId: string; expectedDocumentRevision: number;
  current: FigureRevision; candidate: FigureRevision
}) => Promise<{ decision: 'confirmed'; confirmationId: string } | { decision: 'cancelled' }>

const ROOT = '.scientific-figures'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
}
const jsonBytes = (value: unknown) => encoder.encode(stable(value))
const clone = <T>(value: T): T => structuredClone(value)
const locks = new Map<string, Promise<void>>()
async function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>(r => { release = r })
  locks.set(key, tail)
  await previous
  try { return await run() } finally { release(); if (locks.get(key) === tail) locks.delete(key) }
}

/** Small file-backed store. Inject confirmation only from trusted native orchestration, never tool/UI JSON.
 * workspaceRoot must identify the same canonical authorized workspace across adapters/instances.
 * Atomicity/serialization covers this process; adapters must prevent concurrent writers in other processes.
 */
export class FigureStore {
  private readonly workspaceRoot: string
  constructor(workspaceRoot: string, private readonly fs: FigureFileSystem, private readonly confirm?: FigureConfirmation) {
    this.workspaceRoot = resolve(workspaceRoot)
  }
  private lock<T>(documentId: string, run: () => Promise<T>): Promise<T> {
    return serialized(`${this.workspaceRoot}\0${documentId}`, () => this.fs.withLock ? this.fs.withLock(this.workspaceRoot, documentId, run) : run())
  }
  private docPath(documentId: string) { return `documents/${documentId}/document.json` }
  private async bytes(path: string) { return this.fs.read(this.workspaceRoot, `${ROOT}/${relativePath.parse(path)}`) }
  private async json(path: string): Promise<unknown | null> {
    const bytes = await this.bytes(path)
    return bytes === null ? null : JSON.parse(decoder.decode(bytes))
  }
  private async atomic(path: string, value: unknown) {
    await this.fs.writeAtomic(this.workspaceRoot, `${ROOT}/${relativePath.parse(path)}`, jsonBytes(value))
  }
  private async immutable(path: string, bytes: Uint8Array) {
    const existing = await this.bytes(path)
    if (existing !== null) {
      if (digest(existing) !== digest(bytes) || existing.byteLength !== bytes.byteLength) throw new Error(`Immutable content conflict: ${path}`)
      return
    }
    await this.fs.writeImmutable(this.workspaceRoot, `${ROOT}/${relativePath.parse(path)}`, bytes)
  }
  private async verifyFile(ref: z.infer<typeof fileRef>) {
    const bytes = await this.bytes(ref.path)
    if (bytes === null || bytes.byteLength !== ref.byteLength || digest(bytes) !== ref.sha256) throw new Error(`Missing or corrupt file: ${ref.path}`)
  }
  private async load(documentId: string): Promise<FigureDocument> {
    const raw = await this.json(this.docPath(documentId))
    if (raw === null) throw new Error(`Document not found: ${documentId}`)
    const doc = documentSchema.parse(raw)
    if (doc.documentId !== documentId) throw new Error('Document identity mismatch')
    const seen = new Set<string>()
    for (const { metadata: revision } of doc.revisions) {
      if (seen.has(revision.revisionId)) throw new Error('Duplicate revision')
      seen.add(revision.revisionId)
      const prefix = `documents/${documentId}`
      const extension = this.extension(revision.originalFilename)
      if (revision.image.path !== `${prefix}/images/${revision.revisionId}.${extension}` || revision.format !== extension.toLowerCase()) throw new Error('Image path/format mismatch')
      const stored = revisionSchema.parse(await this.json(`${prefix}/revisions/${revision.revisionId}.json`))
      if (stable(stored) !== stable(revision)) throw new Error('Revision metadata mismatch')
      await this.verifyFile(revision.image)
      if (revision.execution) await this.verifyExecution(revision.execution, revision.image)
      if (revision.sourceCode) await this.verifySourceCode(revision.sourceCode)
      if (revision.generation) {
        const source = revision.generation
        for (const [key, filename] of [['recipe', 'recipe.json'], ['code', 'code.py'], ['inputs', 'inputs.json']] as const) {
          if (source[key].path !== `${prefix}/sources/${source.generationId}/${filename}`) throw new Error('Source path mismatch')
          await this.verifyFile(source[key])
        }
        sourceJsonSchema.parse(await this.json(source.recipe.path))
        sourceJsonSchema.parse(await this.json(source.inputs.path))
      }
    }
    if (!seen.has(doc.originalRevisionId) || !seen.has(doc.currentRevisionId)) throw new Error('Dangling revision pointer')
    const original = doc.revisions.find(r => r.metadata.revisionId === doc.originalRevisionId)!
    const current = doc.revisions.find(r => r.metadata.revisionId === doc.currentRevisionId)!
    if (original.status !== 'original' || original.metadata.baseline !== null || !['original', 'accepted'].includes(current.status)) throw new Error('Invalid revision state')
    for (const r of doc.revisions) {
      const baseline = r.metadata.baseline
      if (r !== original && (!baseline || !doc.revisions.some(b => b.metadata.revisionId === baseline.revisionId && b.metadata.image.sha256 === baseline.sha256))) throw new Error('Invalid baseline')
    }
    if (new Set(doc.operations.map(o => o.operationId)).size !== doc.operations.length || new Set(doc.annotations.map(a => a.id)).size !== doc.annotations.length) throw new Error('Duplicate operation/annotation')
    for (const receipt of doc.operations) {
      if (receipt.result.documentId !== documentId || receipt.result.documentRevision > doc.documentRevision || !seen.has(receipt.result.currentRevisionId) || (receipt.result.revisionId && !seen.has(receipt.result.revisionId))) throw new Error('Invalid operation receipt')
    }
    for (const acceptance of doc.acceptances) {
      if (!seen.has(acceptance.revisionId) || !seen.has(acceptance.previousRevisionId) || acceptance.documentRevision > doc.documentRevision) throw new Error('Invalid acceptance record')
    }
    return doc
  }
  async read(documentId: string): Promise<FigureDocument> {
    return this.lock(id.parse(documentId), () => this.load(documentId))
  }
  /** Index is a discoverability cache. Scan committed document.json files before replacing it;
   * this recovers a commit whose later index update failed. Partial dirs without document.json
   * are ignored; indexed missing/corrupt documents fail closed. No files are deleted/migrated.
   */
  async list(): Promise<Array<{ documentId: string; path: string }>> {
    return this.lock('@index', async () => {
      const raw = await this.json('store.json')
      const index = raw === null ? { schemaVersion: 1 as const, documents: [] } : indexSchema.parse(raw)
      const ids = new Set<string>()
      for (const entry of index.documents) {
        if (entry.path !== this.docPath(entry.documentId) || ids.has(entry.documentId)) throw new Error('Invalid index entry')
        ids.add(entry.documentId)
        await this.load(entry.documentId)
      }
      for (const name of await this.fs.listDirectories(this.workspaceRoot, `${ROOT}/documents`)) {
        id.parse(name)
        if (ids.has(name)) continue
        if (await this.bytes(this.docPath(name)) === null) continue
        await this.load(name)
        ids.add(name)
      }
      const documents = [...ids].sort().map(documentId => ({ documentId, path: this.docPath(documentId) }))
      if (raw === null || stable(documents) !== stable(index.documents)) await this.atomic('store.json', { schemaVersion: 1, documents })
      return documents
    })
  }
  /** Trusted renderer orchestration only: key must be SHA256 of the full canonical original
   * request including action, all parameters and data content. Never accept a key from UI/tool JSON.
   * Call before repeating expensive/nondeterministic generation. Import snapshots still compare bytes.
   */
  async replayOperation(documentId: string, operationId: string, requestKey: string): Promise<FigureOperationResult | undefined> {
    id.parse(documentId); id.parse(operationId); hash.parse(requestKey)
    return this.lock(documentId, async () => {
      if (await this.bytes(this.docPath(documentId)) === null) return undefined
      const doc = await this.load(documentId)
      const receipt = doc.operations.find(o => o.operationId === operationId)
      if (!receipt) return undefined
      if (receipt.requestKey !== requestKey) throw new Error('Operation ID already used with different request')
      return clone(receipt.result)
    })
  }
  private extension(filename: string): string {
    imageSchema.shape.originalFilename.parse(filename)
    return filename.slice(filename.lastIndexOf('.') + 1)
  }
  private fingerprint(kind: string, input: unknown): string {
    const value = clone(input) as Record<string, unknown>
    // A native renderer's full request hash is its logical input. Rendered bytes can contain
    // timestamps; a repeated generation must return the original committed result.
    if (value.requestKey) return digest(jsonBytes({ kind, requestKey: value.requestKey }))
    if ('image' in value) {
      const image = value.image as FigureImage
      value.image = { ...image, bytes: { sha256: digest(image.bytes), byteLength: image.bytes.byteLength } }
    }
    return digest(jsonBytes({ kind, input: value }))
  }
  private replay(doc: FigureDocument, operationId: string, inputHash: string): FigureOperationResult | undefined {
    const receipt = doc.operations.find(o => o.operationId === operationId)
    if (!receipt) return undefined
    if (receipt.inputHash !== inputHash) throw new Error('Operation ID already used with different input')
    return clone(receipt.result)
  }
  private expected(doc: FigureDocument, expected: number) {
    if (doc.documentRevision !== expected) throw new Error('Stale document revision')
  }
  private async verifyExecution(link: FigureExecutionLink, image: z.infer<typeof fileRef>) {
    const { CodeRunStore } = await import('./code-runs.js')
    const runs = new CodeRunStore(this.workspaceRoot, this.fs)
    if (link.run.path !== `runs/${link.runId}/run.json` || link.output.sha256 !== image.sha256 || link.output.byteLength !== image.byteLength) throw new Error('Image execution link mismatch')
    await this.verifyFile(link.run)
    const run = await runs.run(link.runId)
    if (run.status !== 'completed' || run.codeRevisionId !== link.codeRevisionId || !run.outputs.some(o => stable(o) === stable(link.output))) throw new Error('Unverified execution output')
  }
  private async verifySourceCode(source: FigureSourceCode) {
    const { CodeRunStore } = await import('./code-runs.js')
    if (source.code.path !== `codes/${source.codeRevisionId}/code.json`) throw new Error('Source code path mismatch')
    const codes = new CodeRunStore(this.workspaceRoot, this.fs)
    await codes.verify(source.code)
    await codes.code(source.codeRevisionId)
  }
  private async snapshot(documentId: string, image: FigureImage, baseline: FigureRevision['baseline'], generation?: FigureGeneration, execution?: FigureExecutionLink, sourceCode?: FigureSourceCode): Promise<FigureRevision> {
    const prefix = `documents/${documentId}`
    const makeRef = (path: string, bytes: Uint8Array) => ({ path, sha256: digest(bytes), byteLength: bytes.byteLength })
    const revision: FigureRevision = { revisionId: image.revisionId, originalFilename: image.originalFilename, format: this.extension(image.originalFilename).toLowerCase(),
      image: makeRef(`${prefix}/images/${image.revisionId}.${this.extension(image.originalFilename)}`, image.bytes), baseline }
    if (execution) { await this.verifyExecution(execution, revision.image); revision.execution = clone(execution) }
    if (sourceCode) { await this.verifySourceCode(sourceCode); revision.sourceCode = clone(sourceCode) }
    if (generation) {
      const sourcePrefix = `${prefix}/sources/${generation.generationId}`
      revision.generation = { generationId: generation.generationId,
        recipe: makeRef(`${sourcePrefix}/recipe.json`, jsonBytes(generation.recipe)),
        code: makeRef(`${sourcePrefix}/code.py`, encoder.encode(generation.code)),
        inputs: makeRef(`${sourcePrefix}/inputs.json`, jsonBytes(generation.inputs)) }
      await this.immutable(revision.generation.recipe.path, jsonBytes(generation.recipe))
      await this.immutable(revision.generation.code.path, encoder.encode(generation.code))
      await this.immutable(revision.generation.inputs.path, jsonBytes(generation.inputs))
    }
    await this.immutable(revision.image.path, image.bytes)
    await this.immutable(`${prefix}/revisions/${image.revisionId}.json`, jsonBytes(revision))
    return revision
  }
  private async commit(doc: FigureDocument, operationId: string, inputHash: string, status: FigureOperationResult['status'], revisionId?: string, requestKey?: string): Promise<FigureOperationResult> {
    doc.documentRevision++
    const result = resultSchema.parse({ documentId: doc.documentId, documentRevision: doc.documentRevision, currentRevisionId: doc.currentRevisionId, status, ...(revisionId ? { revisionId } : {}) })
    doc.operations.push({ operationId, inputHash, ...(requestKey ? { requestKey } : {}), result })
    await this.atomic(this.docPath(doc.documentId), documentSchema.parse(doc))
    return clone(result)
  }
  async create(request: CreateFigureInput): Promise<FigureOperationResult> {
    const input = clone(createSchema.parse(request))
    const inputHash = this.fingerprint('create', input)
    const result = await this.lock(input.documentId, async () => {
      if (await this.bytes(this.docPath(input.documentId)) !== null) {
        const doc = await this.load(input.documentId)
        const previous = this.replay(doc, input.operationId, inputHash)
        if (previous) return previous
        throw new Error('Document already exists')
      }
      if (input.expectedDocumentRevision !== 0) throw new Error('New document requires revision zero')
      const revision = await this.snapshot(input.documentId, input.image, null, input.generation, input.execution, input.sourceCode)
      const doc: FigureDocument = { schemaVersion: 1, documentId: input.documentId, documentRevision: 0,
        originalRevisionId: revision.revisionId, currentRevisionId: revision.revisionId,
        revisions: [{ metadata: revision, status: 'original' }], annotations: [], acceptances: [], operations: [] }
      return this.commit(doc, input.operationId, inputHash, 'created', revision.revisionId, input.requestKey)
    })
    await this.list()
    return result
  }
  async addCandidate(request: AddCandidateInput): Promise<FigureOperationResult> {
    const input = clone(candidateSchema.parse(request))
    const inputHash = this.fingerprint('addCandidate', input)
    return this.lock(input.documentId, async () => {
      const doc = await this.load(input.documentId)
      const previous = this.replay(doc, input.operationId, inputHash)
      if (previous) return previous
      this.expected(doc, input.expectedDocumentRevision)
      const current = doc.revisions.find(r => r.metadata.revisionId === doc.currentRevisionId)!.metadata
      if (input.baselineRevisionId !== current.revisionId || input.baselineHash !== current.image.sha256) throw new Error('Stale candidate baseline')
      if (doc.revisions.some(r => r.metadata.revisionId === input.image.revisionId)) throw new Error('Revision ID already exists')
      const revision = await this.snapshot(input.documentId, input.image, { revisionId: current.revisionId, sha256: current.image.sha256 }, input.generation, input.execution, input.sourceCode)
      doc.revisions.push({ metadata: revision, status: 'candidate' })
      return this.commit(doc, input.operationId, inputHash, 'candidate_added', revision.revisionId, input.requestKey)
    })
  }
  async saveAnnotations(request: SaveAnnotationsInput): Promise<FigureOperationResult> {
    const input = clone(annotationsSchema.parse(request))
    if (new Set(input.annotations.map(a => a.id)).size !== input.annotations.length) throw new Error('Duplicate annotation ID')
    const inputHash = this.fingerprint('saveAnnotations', input)
    return this.lock(input.documentId, async () => {
      const doc = await this.load(input.documentId)
      const previous = this.replay(doc, input.operationId, inputHash)
      if (previous) return previous
      this.expected(doc, input.expectedDocumentRevision)
      doc.annotations = input.annotations
      return this.commit(doc, input.operationId, inputHash, 'annotations_saved')
    })
  }
  private candidate(doc: FigureDocument, revisionId: string, checkBaseline: boolean) {
    const candidate = doc.revisions.find(r => r.metadata.revisionId === revisionId)
    if (!candidate || candidate.status !== 'candidate') throw new Error('Revision is not a pending candidate')
    const current = doc.revisions.find(r => r.metadata.revisionId === doc.currentRevisionId)!.metadata
    if (checkBaseline && (candidate.metadata.baseline?.revisionId !== current.revisionId || candidate.metadata.baseline.sha256 !== current.image.sha256)) throw new Error('Stale candidate baseline')
    return { candidate, current }
  }
  async acceptCandidate(request: DecideCandidateInput): Promise<FigureOperationResult> {
    const input = clone(decisionSchema.parse(request))
    const inputHash = this.fingerprint('acceptCandidate', input)
    const prepared = await this.lock(input.documentId, async () => {
      const doc = await this.load(input.documentId)
      const previous = this.replay(doc, input.operationId, inputHash)
      if (previous) return { previous }
      this.expected(doc, input.expectedDocumentRevision)
      const { candidate, current } = this.candidate(doc, input.revisionId, true)
      return { context: clone({ documentId: input.documentId, operationId: input.operationId, expectedDocumentRevision: input.expectedDocumentRevision, current, candidate: candidate.metadata }) }
    })
    if (prepared.previous) return prepared.previous
    if (!this.confirm) throw new Error('Trusted confirmation capability required')
    const confirmation = z.discriminatedUnion('decision', [
      z.object({ decision: z.literal('confirmed'), confirmationId: id }).strict(),
      z.object({ decision: z.literal('cancelled') }).strict()
    ]).parse(await this.confirm(prepared.context!))
    return this.lock(input.documentId, async () => {
      // Deliberately reload after awaiting confirmation: every image and baseline is reverified.
      const doc = await this.load(input.documentId)
      const previous = this.replay(doc, input.operationId, inputHash)
      if (previous) return previous
      this.expected(doc, input.expectedDocumentRevision)
      const { candidate, current } = this.candidate(doc, input.revisionId, true)
      if (confirmation.decision === 'cancelled') return this.commit(doc, input.operationId, inputHash, 'cancelled', input.revisionId)
      candidate.status = 'accepted'
      doc.currentRevisionId = input.revisionId
      doc.acceptances.push({ operationId: input.operationId, revisionId: input.revisionId, previousRevisionId: current.revisionId, confirmationId: confirmation.confirmationId, documentRevision: doc.documentRevision + 1 })
      return this.commit(doc, input.operationId, inputHash, 'accepted', input.revisionId)
    })
  }
  private async dismiss(request: DecideCandidateInput, status: 'rejected' | 'cancelled'): Promise<FigureOperationResult> {
    const input = clone(decisionSchema.parse(request))
    const inputHash = this.fingerprint(status, input)
    return this.lock(input.documentId, async () => {
      const doc = await this.load(input.documentId)
      const previous = this.replay(doc, input.operationId, inputHash)
      if (previous) return previous
      this.expected(doc, input.expectedDocumentRevision)
      this.candidate(doc, input.revisionId, false).candidate.status = status
      return this.commit(doc, input.operationId, inputHash, status, input.revisionId)
    })
  }
  rejectCandidate(request: DecideCandidateInput) { return this.dismiss(request, 'rejected') }
  cancelCandidate(request: DecideCandidateInput) { return this.dismiss(request, 'cancelled') }
}
