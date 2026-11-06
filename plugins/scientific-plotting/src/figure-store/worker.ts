import { createHash } from 'node:crypto'
import { basename, extname, isAbsolute, relative, join } from 'node:path'
import { loadImage } from '@napi-rs/canvas'
import { FigureStore, type DecideCandidateInput } from './index.js'
import { ConfinedFigureFiles } from './node-files.js'
import { CodeRunStore } from './code-runs.js'

/** Private stdin transport. This worker must be launched by native-dsh through DSH confinement. */
export async function dispatch(request: { action: string; input: Record<string, any>; workspaceRoot: string; pythonCommand?: string; approvalGranted?: boolean; confirmationId?: string; preflight?: Record<string, unknown>; execution?: Record<string, any> }): Promise<unknown> {
  const { input, workspaceRoot } = request
  const files = new ConfinedFigureFiles()
  const store = new FigureStore(workspaceRoot, files, async () => request.approvalGranted === true
    ? { decision: 'confirmed', confirmationId: request.confirmationId ?? 'native-confirmation' }
    : { decision: 'cancelled' })
  const revisionId = `r-${createHash('sha256').update(String(input.operationId)).digest('hex').slice(0, 32)}`
  const mutation = () => ({ documentId: input.documentId, operationId: input.operationId, expectedDocumentRevision: input.expectedDocumentRevision })
  const readImage = async () => {
    if (typeof input.path !== 'string' || isAbsolute(input.path)) throw new Error('Input image path must be workspace-relative')
    const bytes = await files.read(workspaceRoot, input.path)
    if (!bytes) throw new Error('Input image missing')
    const extension = extname(input.path).slice(1).toLowerCase()
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(extension)) throw new Error('Unsupported raster image format')
    await loadImage(Buffer.from(bytes))
    return { revisionId, originalFilename: basename(input.path), bytes: Uint8Array.from(bytes) }
  }
  const codeRuns = new CodeRunStore(workspaceRoot, files)
  switch (request.action) {
    case 'saveCode': return codeRuns.save(input)
    case 'listCodes': return codeRuns.listCodes(input)
    case 'readCode': return codeRuns.source(input.codeRevisionId)
    case 'listRuns': return codeRuns.listRuns(input)
    case 'listPendingRuns': return codeRuns.listPending()
    case 'readRun': return codeRuns.run(input.runId)
    case 'preparePython': {
      const { preparePythonSnapshot } = await import('../execution/index.js')
      const code = await codeRuns.code(input.codeRevisionId)
      const prefix = `codes/${code.codeRevisionId}/files/`
      const sourceFiles = await Promise.all(code.files.map(async f => ({ path: f.path.slice(prefix.length), content: Buffer.from(await codeRuns.verify(f)).toString('utf8') })))
      const inputFiles = await Promise.all(code.inputs.map(async f => ({ path: f.originalPath, bytes: await codeRuns.verify(f.snapshot) })))
      const reservation = await codeRuns.reserveRun(input.runId, input.codeRevisionId)
      if (reservation.completed) return { completed: reservation.completed }
      if (reservation.recovery) return { recovery: true, ...reservation.recovery }
      try {
        const prepared = await preparePythonSnapshot({ pythonCommand: request.pythonCommand ?? 'python3', workspaceRoot, files: sourceFiles, entrypoint: code.entrypoint, parameters: code.parameters, inputFiles })
        await codeRuns.recordStage(input.runId, relative(join(workspaceRoot, '.scientific-figures'), prepared.stageRoot), prepared.identity)
        return { prepared }
      }
      catch (error) {
        return { completed: await codeRuns.execute(input.runId, input.codeRevisionId, async () => ({ status: 'failed', exitCode: null, stdout: '', stderr: '', environment: { language: 'python' }, outputs: [], error: error instanceof Error ? error.message : String(error) })) }
      }
    }
    case 'finalizePython': {
      if (!request.execution?.prepared || !request.execution?.outcome) throw new Error('Trusted execution outcome required')
      const { collectPythonSnapshot, cleanupPythonSnapshot } = await import('../execution/index.js')
      const pending = await codeRuns.pendingRun(input.runId)
      if (pending.codeRevisionId !== input.codeRevisionId) throw new Error('Run reservation mismatch')
      // Persist the exact host-observed result before collection or run commit. This is
      // the only source for interrupted finalization; never reconstruct process facts.
      const execution = await codeRuns.recordOutcome(input.runId, request.execution)
      const run = await codeRuns.execute(input.runId, input.codeRevisionId, async () => {
        if (execution.outcome.quiescent === false) return { status: 'failed', exitCode: execution.outcome.exitCode, stdout: execution.outcome.stdout, stderr: execution.outcome.stderr, environment: { language: 'python' }, outputs: [], error: `Process range not stopped; staging retained for inspection: ${String(execution.outcome.error ?? '')}` } as const
        const result = await collectPythonSnapshot(execution.prepared, execution.outcome, { cleanup: false })
        return { status: result.status, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, stdoutTruncated: result.stdoutTruncated, stderrTruncated: result.stderrTruncated, outputs: result.outputs, environment: result.environment, ...(result.error ? { error: JSON.stringify(result.error) } : {}) }
      })
      // Uncertain commit/collection retains evidence. Cleanup failures never rewrite a
      // durable terminal record; identity validation also refuses replaced stages.
      if (execution.outcome.quiescent !== false) {
        try { await cleanupPythonSnapshot(execution.prepared) } catch { /* Retain staging for inspection. */ }
      }
      return run
    }
    case 'publishRun': {
      const run = await codeRuns.run(input.runId)
      if (run.status !== 'completed') throw new Error('Only a completed run can publish a figure')
      const output = run.outputs.find(o => o.path === input.outputPath)
      if (!output) throw new Error('Run output not found')
      if (extname(output.path).toLowerCase() !== '.png') throw new Error('Only PNG run outputs can be published as figures')
      const bytes = await codeRuns.verify(output)
      await loadImage(Buffer.from(bytes))
      const image = { revisionId, originalFilename: basename(output.path), bytes: Uint8Array.from(bytes) }
      const execution = { codeRevisionId: run.codeRevisionId, runId: run.runId, run: await codeRuns.reference(`runs/${run.runId}/run.json`), output }
      return input.expectedDocumentRevision === 0
        ? store.create({ ...mutation(), image, execution })
        : store.addCandidate({ ...mutation(), image, execution, baselineRevisionId: input.baselineRevisionId, baselineHash: input.baselineHash })
    }
    case 'list': return store.list()
    case 'read': return store.read(input.documentId)
    case 'importOriginal': return store.create({ ...mutation(), image: await readImage() })
    case 'importBaseline': {
      const code = await codeRuns.code(input.codeRevisionId)
      const sourceCode = { codeRevisionId: code.codeRevisionId, code: await codeRuns.reference(`codes/${code.codeRevisionId}/code.json`), provenance: 'supplied' as const, verification: 'unverified' as const }
      return store.create({ ...mutation(), image: await readImage(), sourceCode })
    }
    case 'addCandidate': return store.addCandidate({ ...mutation(), image: await readImage(), baselineRevisionId: input.baselineRevisionId, baselineHash: input.baselineHash })
    case 'saveAnnotations': return store.saveAnnotations({ ...mutation(), annotations: input.annotations })
    case 'rejectCandidate': return store.rejectCandidate({ ...mutation(), revisionId: input.revisionId })
    case 'image': {
      const doc = await store.read(input.documentId)
      const revision = doc.revisions.find(r => r.metadata.revisionId === input.revisionId)?.metadata
      if (!revision) throw new Error('Image revision not found')
      const bytes = await files.read(workspaceRoot, `.scientific-figures/${revision.image.path}`)
      if (!bytes || bytes.byteLength !== revision.image.byteLength || createHash('sha256').update(bytes).digest('hex') !== revision.image.sha256) throw new Error('Image missing or corrupt')
      const image = await loadImage(Buffer.from(bytes))
      const extension = extname(revision.image.path).slice(1).toLowerCase()
      const mediaType = extension === 'jpg' ? 'jpeg' : extension
      return { src: `data:image/${mediaType};base64,${Buffer.from(bytes).toString('base64')}`, width: image.width, height: image.height }
    }
    case 'preflightAccept': {
      const doc = await store.read(input.documentId)
      const receipt = doc.operations.find(o => o.operationId === input.operationId)
      if (receipt) {
        // Let the canonical store validate the full fingerprint before returning a replay.
        return { alreadyCompleted: await store.acceptCandidate(input as DecideCandidateInput) }
      }
      if (doc.documentRevision !== input.expectedDocumentRevision) throw new Error('Stale document revision; review again')
      const candidate = doc.revisions.find(r => r.metadata.revisionId === input.revisionId)
      const current = doc.revisions.find(r => r.metadata.revisionId === doc.currentRevisionId)!
      if (!candidate || candidate.status !== 'candidate' || candidate.metadata.baseline?.revisionId !== current.metadata.revisionId || candidate.metadata.baseline.sha256 !== current.metadata.image.sha256) throw new Error('Stale candidate baseline; review again')
      return { documentId: doc.documentId, documentRevision: doc.documentRevision, currentRevisionId: doc.currentRevisionId, candidateRevisionId: candidate.metadata.revisionId, candidateHash: candidate.metadata.image.sha256, baselineHash: current.metadata.image.sha256, ...(candidate.metadata.execution ? { execution: candidate.metadata.execution } : {}) }
    }
    case 'acceptCandidate': {
      if (!request.preflight) throw new Error('Native preflight required')
      const doc = await store.read(input.documentId)
      const candidate = doc.revisions.find(r => r.metadata.revisionId === input.revisionId)
      if (doc.documentRevision !== request.preflight.documentRevision || doc.currentRevisionId !== request.preflight.currentRevisionId || candidate?.metadata.image.sha256 !== request.preflight.candidateHash) throw new Error('Document changed during confirmation; review again')
      return store.acceptCandidate(input as DecideCandidateInput)
    }
    case 'prepareTemplate': {
      const { prepareTemplateCode } = await import('../worker/scientific-plotting-engine.js')
      const prepared = await prepareTemplateCode({ ...input.request, workspaceRoot, documentId: input.documentId, generationId: revisionId } as never)
      return codeRuns.save({ ...prepared, parameters: { ...prepared.parameters, _scientificRequest: input.request }, codeRevisionId: input.codeRevisionId })
    }
    case 'status': {
      const { getScientificPlottingStatus } = await import('../worker/scientific-plotting-engine.js')
      return getScientificPlottingStatus({ pythonCommand: request.pythonCommand })
    }
    default: throw new Error('Unknown Scientific Figures operation')
  }
}

async function main(): Promise<void> {
  try {
    let text = ''
    for await (const chunk of process.stdin) { text += chunk; if (text.length > 8 * 1024 * 1024) throw new Error('Request exceeds 8 MiB') }
    const result = await dispatch(JSON.parse(text))
    process.stdout.write(JSON.stringify(result))
  } catch (error) { process.stderr.write(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
if (process.argv.includes('--stdio')) void main()
