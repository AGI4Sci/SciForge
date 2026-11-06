import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import { z } from 'zod'
import { sourceJsonSchema, type FigureFileSystem } from './index.js'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
// ASCII controls must be rejected in persisted and workspace paths.
// eslint-disable-next-line no-control-regex
const path = z.string().max(2048).refine(p => !/[\x00-\x1f\x7f:]/.test(p) && !/^(?:[/\\]|[A-Za-z]:)/.test(p) && !p.includes('\\') && p.split('/').every(s => s && s !== '.' && s !== '..'), 'Safe relative path required')
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const encode = (v: unknown) => Buffer.from(JSON.stringify(v))
const logicalPath = path.refine(p => p.length <= 240, 'Snapshot path exceeds 240 characters')
const ref = z.object({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().nonnegative() }).strict()
export const saveCodeSchema = z.object({ codeRevisionId: id, parentCodeRevisionId: id.nullable().default(null), entrypoint: logicalPath, files: z.array(z.object({ path: logicalPath, content: z.string().max(2_000_000) }).strict()).min(1).max(100), parameters: sourceJsonSchema.default({}), inputPaths: z.array(logicalPath).max(100).optional() }).strict()
export const codeSchema = z.object({ schemaVersion: z.literal(1), codeRevisionId: id, language: z.literal('python'), parentCodeRevisionId: id.nullable(), entrypoint: path, parameters: sourceJsonSchema, files: z.array(ref), inputs: z.array(z.object({ originalPath: path, snapshot: ref }).strict()), createdAt: z.string().datetime(), requestHash: z.string() }).strict()
export type CodeRevision = z.infer<typeof codeSchema>
export const runSchema = z.object({ schemaVersion: z.literal(1), runId: id, codeRevisionId: id, code: ref, status: z.enum(['completed', 'failed', 'cancelled']), exitCode: z.number().int().nullable(), stdout: z.string(), stderr: z.string(), stdoutTruncated: z.boolean().default(false), stderrTruncated: z.boolean().default(false), error: z.string().optional(), environment: sourceJsonSchema, outputs: z.array(ref), startedAt: z.string().datetime(), finishedAt: z.string().datetime() }).strict()
export type CodeRun = z.infer<typeof runSchema>
const ROOT = '.scientific-figures'

export type HistoryPageInput = { limit?: number; cursor?: string }
export type HistoryPage<T> = { items: T[]; nextCursor: string | null; errors: Array<{ id: string; error: string }> }
export type CodeRevisionSummary = Pick<CodeRevision, 'codeRevisionId' | 'parentCodeRevisionId' | 'entrypoint' | 'createdAt'>
export type CodeRunSummary = Pick<CodeRun, 'runId' | 'codeRevisionId' | 'status' | 'startedAt' | 'finishedAt' | 'error'>
const pageSchema = z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: id.optional() }).strict()
const identitySchema = z.object({ dev: z.number().int().nonnegative(), ino: z.number().int().nonnegative() }).strict()
const stageSchema = z.object({ path: z.string().regex(/^\.runs-temp\/python-[A-Za-z0-9]+$/), identity: identitySchema }).strict()
const executionSchema = z.object({
  prepared: z.object({ stageRoot: z.string(), stagingRoot: z.string(), identity: identitySchema, cwd: z.string(), argv: z.array(z.string()).min(1), env: z.record(z.string(), z.string()), timeoutMs: z.number().int().min(1).max(600_000) }).strict(),
  outcome: z.object({ exitCode: z.number().int().nullable(), stdout: z.string().max(256 * 1024), stderr: z.string().max(256 * 1024), stdoutTruncated: z.boolean().optional(), stderrTruncated: z.boolean().optional(), status: z.enum(['completed', 'failed', 'cancelled']).optional(), error: z.union([z.string().max(8192), z.object({ code: z.string().max(256), message: z.string().max(8192) }).strict()]).optional(), quiescent: z.boolean().optional() }).strict(),
}).strict()
const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1024)

/** Immutable code and terminal run records, owned by this plugin. IO only in confined worker. */
export class CodeRunStore {
  constructor(private root: string, private fs: FigureFileSystem) {}
  private async bytes(p: string) { const b = await this.fs.read(this.root, `${ROOT}/${p}`); if (!b) throw new Error(`Missing snapshot: ${p}`); return b }
  private async put(p: string, bytes: Uint8Array) {
    const old = await this.fs.read(this.root, `${ROOT}/${p}`)
    if (old) { if (sha(old) !== sha(bytes)) throw new Error(`Immutable conflict: ${p}`) }
    else await this.fs.writeImmutable(this.root, `${ROOT}/${p}`, bytes)
    return { path: p, sha256: sha(bytes), byteLength: bytes.byteLength }
  }
  async verify(r: z.infer<typeof ref>) { const b = await this.bytes(r.path); if (b.byteLength !== r.byteLength || sha(b) !== r.sha256) throw new Error(`Corrupt snapshot: ${r.path}`); return b }
  async code(codeRevisionId: string): Promise<CodeRevision> {
    id.parse(codeRevisionId)
    const c = codeSchema.parse(JSON.parse(Buffer.from(await this.bytes(`codes/${codeRevisionId}/code.json`)).toString('utf8')))
    if (c.codeRevisionId !== codeRevisionId) throw new Error('Code identity mismatch')
    for (const f of c.files) { if (!f.path.startsWith(`codes/${codeRevisionId}/files/`)) throw new Error('Code path mismatch'); await this.verify(f) }
    for (const f of c.inputs) { if (!f.snapshot.path.startsWith(`codes/${codeRevisionId}/inputs/`)) throw new Error('Input path mismatch'); await this.verify(f.snapshot) }
    return c
  }
  async save(raw: unknown): Promise<CodeRevision> {
    const input = saveCodeSchema.parse(raw)
    if (Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024) throw new Error('Code snapshot request exceeds 2 MiB')
    if (!input.entrypoint.endsWith('.py') || !input.files.some(f => f.path === input.entrypoint)) throw new Error('Entrypoint must be a supplied .py file')
    if (new Set(input.files.map(f => f.path)).size !== input.files.length || new Set(input.inputPaths).size !== (input.inputPaths?.length ?? 0)) throw new Error('Duplicate snapshot path')
    if (input.parentCodeRevisionId === input.codeRevisionId) throw new Error('Code cannot be its own parent')
    const parent = input.parentCodeRevisionId ? await this.code(input.parentCodeRevisionId) : null
    const requestHash = sha(encode(input))
    const work = async () => {
      const existing = await this.fs.read(this.root, `${ROOT}/codes/${input.codeRevisionId}/code.json`)
      if (existing) { const c = await this.code(input.codeRevisionId); if (c.requestHash !== requestHash) throw new Error('Code revision ID reused with different request'); return c }
      const inputBytes = []
      let size = 0
      // Omission inherits frozen parent data. An explicit list snapshots current workspace data;
      // [] deliberately removes inputs. Never silently re-read parent originalPath values.
      if (input.inputPaths === undefined && parent) {
        for (const f of parent.inputs) inputBytes.push({ originalPath: f.originalPath, bytes: await this.verify(f.snapshot) })
      } else {
        for (const p of input.inputPaths ?? []) {
          const b = await this.fs.read(this.root, p); if (!b) throw new Error(`Input missing: ${p}`)
          size += b.byteLength; if (size > 64 * 1024 * 1024) throw new Error('Input snapshots exceed 64 MiB')
          inputBytes.push({ originalPath: p, bytes: b })
        }
      }
      const files = []
      for (const f of input.files) files.push(await this.put(`codes/${input.codeRevisionId}/files/${f.path}`, Buffer.from(f.content)))
      const inputs = []
      for (const f of inputBytes) inputs.push({ originalPath: f.originalPath, snapshot: await this.put(`codes/${input.codeRevisionId}/inputs/${f.originalPath}`, f.bytes) })
      const c = codeSchema.parse({ schemaVersion: 1, codeRevisionId: input.codeRevisionId, language: 'python', parentCodeRevisionId: input.parentCodeRevisionId, entrypoint: input.entrypoint, parameters: input.parameters, files, inputs, createdAt: new Date().toISOString(), requestHash })
      await this.put(`codes/${input.codeRevisionId}/code.json`, encode(c)); return c
    }
    return this.fs.withLock ? this.fs.withLock(this.root, `code-${input.codeRevisionId}`, work) : work()
  }
  private async page<T>(kind: 'codes' | 'runs', raw: HistoryPageInput, summarize: (record: unknown, recordId: string) => T): Promise<HistoryPage<T>> {
    const { limit, cursor } = pageSchema.parse(raw)
    // Cursor is the last scanned immutable ID, independent of timestamps, locale and deletion.
    const ids = (await this.fs.listDirectories(this.root, `${ROOT}/${kind}`)).filter(i => id.safeParse(i).success && (!cursor || i < cursor)).sort((a, b) => a < b ? 1 : a > b ? -1 : 0)
    const selected = ids.slice(0, limit)
    const result: HistoryPage<T> = { items: [], nextCursor: ids.length > limit ? selected.at(-1)! : null, errors: [] }
    for (const recordId of selected) {
      try {
        const bytes = await this.fs.read(this.root, `${ROOT}/${kind}/${recordId}/${kind === 'codes' ? 'code' : 'run'}.json`)
        if (bytes) result.items.push(summarize(JSON.parse(Buffer.from(bytes).toString('utf8')), recordId))
      } catch (error) { result.errors.push({ id: recordId, error: describeError(error) }) }
    }
    return result
  }
  async listCodes(input: HistoryPageInput = {}): Promise<HistoryPage<CodeRevisionSummary>> {
    return this.page('codes', input, (record, recordId) => {
      const c = codeSchema.parse(record)
      if (c.codeRevisionId !== recordId) throw new Error('Code identity mismatch')
      return { codeRevisionId: c.codeRevisionId, parentCodeRevisionId: c.parentCodeRevisionId, entrypoint: c.entrypoint, createdAt: c.createdAt }
    })
  }
  async listRuns(input: HistoryPageInput = {}): Promise<HistoryPage<CodeRunSummary>> {
    return this.page('runs', input, (record, recordId) => {
      const r = runSchema.parse(record)
      if (r.runId !== recordId || r.code.path !== `codes/${r.codeRevisionId}/code.json`) throw new Error('Run identity mismatch')
      return { runId: r.runId, codeRevisionId: r.codeRevisionId, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, ...(r.error ? { error: r.error.slice(0, 1024) } : {}) }
    })
  }
  async run(runId: string): Promise<CodeRun> {
    id.parse(runId); const r = runSchema.parse(JSON.parse(Buffer.from(await this.bytes(`runs/${runId}/run.json`)).toString('utf8')))
    if (r.runId !== runId || r.code.path !== `codes/${r.codeRevisionId}/code.json`) throw new Error('Run identity mismatch')
    await this.verify(r.code); await this.code(r.codeRevisionId)
    for (const o of r.outputs) { if (!o.path.startsWith(`runs/${runId}/outputs/`)) throw new Error('Output path mismatch'); await this.verify(o) }
    return r
  }
  async execute(runId: string, codeRevisionId: string, execute: (code: CodeRevision) => Promise<{ status: CodeRun['status']; exitCode: number | null; stdout: string; stderr: string; error?: string; environment: unknown; outputs: Array<{ path: string; bytes: Uint8Array }> }>): Promise<CodeRun> {
    id.parse(runId); id.parse(codeRevisionId)
    const work = async () => {
      if (await this.fs.read(this.root, `${ROOT}/runs/${runId}/run.json`)) { const r = await this.run(runId); if (r.codeRevisionId !== codeRevisionId) throw new Error('Run ID reused for different code'); return r }
      const c = await this.code(codeRevisionId)
      const pending = await this.fs.read(this.root, `${ROOT}/runs/${runId}/pending.json`)
      const reservation = pending ? await this.pendingRun(runId) : null
      if (reservation && reservation.codeRevisionId !== codeRevisionId) throw new Error('Pending code identity mismatch')
      const startedAt = reservation?.startedAt ?? new Date().toISOString()
      const result = await execute(c)
      const outputs = []
      if (result.status === 'completed') for (const o of result.outputs) outputs.push(await this.put(`runs/${runId}/outputs/${path.parse(o.path)}`, o.bytes))
      const r = runSchema.parse({ ...result, schemaVersion: 1, runId, codeRevisionId, code: await this.reference(`codes/${codeRevisionId}/code.json`), outputs, startedAt, finishedAt: new Date().toISOString() })
      await this.put(`runs/${runId}/run.json`, encode(r)); return r
    }
    return this.fs.withLock ? this.fs.withLock(this.root, `run-${runId}`, work) : work()
  }
  async reserveRun(runId: string, codeRevisionId: string): Promise<{ completed?: CodeRun; startedAt?: string; recovery?: z.infer<typeof executionSchema> }> {
    id.parse(runId); id.parse(codeRevisionId)
    const work = async () => {
      if (await this.fs.read(this.root, `${ROOT}/runs/${runId}/run.json`)) { const r = await this.run(runId); if (r.codeRevisionId !== codeRevisionId) throw new Error('Run ID reused for different code'); return { completed: r } }
      await this.code(codeRevisionId)
      if (await this.fs.read(this.root, `${ROOT}/runs/${runId}/pending.json`)) {
        const pending = await this.pendingRun(runId)
        if (pending.codeRevisionId !== codeRevisionId) throw new Error('Pending code identity mismatch')
        const recovery = await this.recoverExecution(runId)
        if (recovery) return { recovery }
        throw new Error('Run already reserved without a durable process outcome; inspect retained staging manually. No process result can be inferred or execution repeated.')
      }
      const startedAt = new Date().toISOString()
      await this.put(`runs/${runId}/pending.json`, encode({ runId, codeRevisionId, startedAt }))
      return { startedAt }
    }
    return this.fs.withLock ? this.fs.withLock(this.root, `run-${runId}`, work) : work()
  }
  async pendingRun(runId: string) { id.parse(runId); const p = z.object({ runId: id, codeRevisionId: id, startedAt: z.string().datetime() }).strict().parse(JSON.parse(Buffer.from(await this.bytes(`runs/${runId}/pending.json`)).toString('utf8'))); if (p.runId !== runId) throw new Error('Pending run identity mismatch'); return p }
  async recordStage(runId: string, stagePath: string, identity: { dev: number; ino: number }) {
    await this.pendingRun(runId)
    if (!/^\.runs-temp\/python-[A-Za-z0-9]+$/.test(stagePath)) throw new Error('Invalid run stage reference')
    await this.put(`runs/${runId}/stage.json`, encode({ path: stagePath, identity }))
  }
  private async validatedExecution(runId: string, raw: unknown) {
    const execution = executionSchema.parse(raw)
    const stage = stageSchema.parse(JSON.parse(Buffer.from(await this.bytes(`runs/${runId}/stage.json`)).toString('utf8')))
    const expected = resolve(this.root, ROOT, stage.path)
    if (execution.prepared.stageRoot !== expected || execution.prepared.stagingRoot !== resolve(this.root, ROOT, '.runs-temp') || execution.prepared.cwd !== resolve(expected, 'snapshot') || execution.prepared.identity.dev !== stage.identity.dev || execution.prepared.identity.ino !== stage.identity.ino) throw new Error('Run stage identity mismatch')
    return execution
  }
  async recordOutcome(runId: string, raw: unknown) {
    await this.pendingRun(runId)
    const execution = await this.validatedExecution(runId, raw)
    await this.put(`runs/${runId}/outcome.json`, encode(execution))
    return execution
  }
  async recoverExecution(runId: string) {
    await this.pendingRun(runId)
    const bytes = await this.fs.read(this.root, `${ROOT}/runs/${runId}/outcome.json`)
    if (!bytes) return null
    const execution = await this.validatedExecution(runId, JSON.parse(Buffer.from(bytes).toString('utf8')))
    if (execution.outcome.quiescent === false) throw new Error('Process range was not confirmed stopped; retained staging requires manual inspection')
    const { prepared } = execution
    const info = await lstat(prepared.stageRoot)
    if (info.isSymbolicLink() || !info.isDirectory() || info.dev !== prepared.identity.dev || info.ino !== prepared.identity.ino || await realpath(prepared.stageRoot) !== prepared.stageRoot || await realpath(prepared.stagingRoot) !== prepared.stagingRoot) throw new Error('Run staging directory identity changed; retained evidence requires manual inspection')
    return execution
  }
  async listPending() {
    const ids = await this.fs.listDirectories(this.root, `${ROOT}/runs`), result = []
    for (const i of ids.sort()) {
      if (!id.safeParse(i).success) continue
      try {
        if (await this.fs.read(this.root, `${ROOT}/runs/${i}/run.json`) || !await this.fs.read(this.root, `${ROOT}/runs/${i}/pending.json`)) continue
        const pending = await this.pendingRun(i)
        let stage: z.infer<typeof stageSchema> | undefined
        let recoverable = false, recoveryError: string | undefined
        try {
          const bytes = await this.fs.read(this.root, `${ROOT}/runs/${i}/stage.json`)
          stage = bytes ? stageSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8'))) : undefined
          recoverable = !!await this.recoverExecution(i)
        } catch (error) { recoveryError = describeError(error) }
        result.push({ ...pending, ...(stage ? { stage } : {}), recoverable, ...(recoveryError ? { recoveryError } : {}) })
      } catch { /* A damaged pending reservation must not hide other interrupted runs. */ }
    }
    return result
  }
  async reference(p: string) { const b = await this.bytes(p); return { path: p, sha256: sha(b), byteLength: b.byteLength } }
  async source(codeRevisionId: string) { const c = await this.code(codeRevisionId); const prefix = `codes/${codeRevisionId}/files/`; return { ...c, sourceFiles: await Promise.all(c.files.map(async f => ({ path: f.path.slice(prefix.length), content: Buffer.from(await this.verify(f)).toString('utf8') }))) } }
}
