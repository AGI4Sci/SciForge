import { exerciseReviewIframe } from './review-ui-fixture.js'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createCanvas } from '@napi-rs/canvas'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createDomainMainEntry as artifactEntry, type ArtifactVersionsCapabilityOptions } from '@sciforge/domain-artifact-versions/main'
import { ARTIFACT_VERSIONS_CAPABILITY_IDS as ids, type ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainHost, DomainMainRuntimeLifecycleContribution } from '@sciforge/domain-sdk/host'
import { editImageFromVisualReviewPacket, renderImageGeneration, reviewImageGenerationCandidate } from '@sciforge/image-generation/engine'
import type { ImageGenerationRecipe } from '@sciforge/image-generation/contract'
import { createVisualReviewCapabilityFactory, type VisualReviewCapabilityOptions, type VisualReviewServicePort } from '../src/review/main.js'
import * as service from '../src/review/main/service.js'
import { VISUAL_REVIEW_CAPABILITY_IDS, visualReviewCreateCandidateInputSchema, visualReviewOpenOutputSchema } from '../src/review/contract.js'
import { ModelSourceDetails } from '../src/review-ui/ModelSourceDetails.js'

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const plan = {
  planId: 'fixture-model-plan', route: 'model', routeLocked: true,
  rationale: 'Synthetic external response for the real execution pipeline.', sourceArtifacts: [], reproducibleInputs: [],
  lockedElements: [], modelOwnedElements: ['composition'], contextStatus: 'ready', contextStopReason: 'sufficient',
  contextEvidenceIds: [], unresolvedContext: [], releaseCeiling: 'publication_ready', fallbackPolicy: 'fail_closed'
} as const

it('captures submitted bytes and prompt, atomically accepts real versions, recovers an interrupted accept, reads old receipts and enforces input policy', async () => {
  const runs = resolve(process.env.SCIFORGE_MODEL_SOURCE_TEST_OUTPUT ?? join(tmpdir(), 'sciforge-model-source-tests'))
  await mkdir(runs, { recursive: true })
  const root = await mkdtemp(join(runs, 'Windows 空格 模型-'))
  const canvas = createCanvas(192, 192)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 192, 192)
  ctx.fillStyle = '#369'; ctx.fillRect(16, 16, 144, 144)
  const original = canvas.toBuffer('image/png')
  ctx.fillStyle = '#b43'; ctx.fillRect(24, 24, 120, 120)
  const generated = canvas.toBuffer('image/png')
  let providerOutput = generated
  const sourcePath = join(root, '原图 with space.png')
  await writeFile(sourcePath, original)
  const entry = artifactEntry<ArtifactVersionsCapabilityOptions>({ defineCapability: (definition: unknown) => definition } as DomainMainHost)
  const lifecycle = entry.contributions.find((c) => 'activate' in (c.value as object))!.value as DomainMainRuntimeLifecycleContribution
  const dispose = await lifecycle.activate({ userDataDir: join(root, 'store') } as Parameters<typeof lifecycle.activate>[0])
  const factory = entry.contributions.find((c) => 'createDefinitions' in (c.value as object))!.value as { createDefinitions(): readonly ArtifactVersionsCapabilityOptions[] }
  const definitions = factory.createDefinitions()
  let callerId = 'reviewer'
  const invoke = async (id: string, input: unknown) => {
    const definition = definitions.find((d) => d.id === id)!
    return definition.outputSchema.parse((await definition.handler(definition.inputSchema.parse(input), { caller: { workspaceId: root, audience: 'ui', callerId } })).output) as any
  }
  const policy = { visibility: 'restricted', principals: ['reviewer'], allowExport: false }
  const base = await invoke(ids.commit, { idempotencyKey: 'fixture-original', candidates: [{ candidateId: 'original', expectedCurrentVersionId: null, kind: 'figure', intent: 'save', content: { mode: 'snapshot', dataBase64: original.toString('base64'), mediaType: 'image/png' }, accessPolicy: policy }] })
  expect(base.ok).toBe(true)
  const baseRef: ArtifactVersionRefV1 = base.value.versions[0].ref
  let interrupt = true
  const real: VisualReviewServicePort = {
    open: service.openVisualReviewDocument, readImage: service.readVisualReviewImage,
    updateContext: service.updateVisualDocumentContext, applyStyleReference: service.applyVisualStyleReference,
    saveAnnotations: service.saveVisualDocumentAnnotations, exportReviewPacket: service.exportVisualReviewPacket,
    createCandidate: service.createVisualCandidateRevision, preflightAcceptCandidate: service.preflightVisualCandidateAcceptance,
    abortPreparedAcceptance: service.abortPreparedVisualCandidateAcceptance,
    acceptCandidate: service.acceptVisualCandidateRevision,
    rejectCandidate: service.rejectVisualCandidateRevision
  }
  const commits: any[] = []
  const review = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
    defineCapability: (value) => value, getService: () => real,
    commitArtifactVersion: async (input) => { const result = await invoke(ids.commit, input); commits.push(result); if (interrupt) { interrupt = false; throw new Error('fixture interruption: committed owner response lost') } return result },
    readArtifactVersion: async (input) => invoke(ids.read, input)
  }).createDefinitions()
  const run = async (id: string, input: unknown) => {
    const definition = review.find((d) => d.id === id)!
    return definition.outputSchema.parse((await definition.handler(definition.inputSchema.parse(input), { caller: { workspaceId: root } })).output) as any
  }
  await run(VISUAL_REVIEW_CAPABILITY_IDS.open, { documentId: 'model', artifact: { kind: 'generated_image', sourcePath, versionRef: baseRef, mimeType: 'image/png' } })
  vi.stubEnv('SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY', 'synthetic-fixture')
  vi.stubEnv('SCIFORGE_MODEL_ROUTER_BASE_URL', 'http://127.0.0.1:3892')
  vi.stubEnv('SCIFORGE_MODEL_ROUTER_IMAGE_MODEL', 'fixture-router')
  const submitted: Array<{ prompt: string; bytes: Buffer }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/images/edits')) {
      const form = init.body as FormData
      submitted.push({ prompt: String(form.get('prompt')), bytes: Buffer.from(await (form.get('image') as File).arrayBuffer()) })
      return Response.json({ data: [{ b64_json: providerOutput.toString('base64') }] })
    }
    if (String(url).endsWith('/responses')) return Response.json({ output_text: JSON.stringify({ pass: true, score: 1, summary: 'Fixture checks passed', violations: [], repairInstructions: [] }) })
    throw new Error('Unexpected synthetic request')
  }))
  const makeCandidate = async (imageId: string, referencePath = sourcePath, documentId = 'model', referenceVersionRefs: ArtifactVersionRefV1[] = []) => {
    const rendered = await renderImageGeneration({ workspaceRoot: root, imageId, recipe: { mode: 'image_to_image', referencePath, prompt: imageId === 'second-v2' ? '第二次调整布局，保持数值' : '调整颜色，保持结构', size: { width: 192, height: 192 }, visualPlan: plan } as unknown as ImageGenerationRecipe })
    if (!rendered.ok) throw new Error(`Generation failed: ${rendered.status}: ${rendered.message}`)
    expect(rendered.ok).toBe(true)
    expect(rendered.modelExecution.effectivePrompt).toBe(submitted.at(-1)!.prompt)
    expect(rendered.modelExecution.model.version).toBeUndefined()
    const capture = rendered.modelExecution.requestCapture!
    expect(capture.promptHash).toBe(hash(submitted.at(-1)!.prompt))
    expect(await readFile(capture.references[0]!.snapshotPath!)).toEqual(submitted.at(-1)!.bytes)
    const qa = await reviewImageGenerationCandidate({ workspaceRoot: root, outputPath: rendered.outputPath, manifestPath: rendered.manifestPath, task: 'check fixture', minOverall: 0 })
    expect(qa.ok).toBe(true)
    if (!qa.ok) throw new Error(qa.message)
    const input = visualReviewCreateCandidateInputSchema.parse({ documentId, referenceVersionRefs, candidatePath: rendered.outputPath, summary: 'Fixture edit', reviewEvidence: { tool: 'image_generation_review_candidate', ...qa } })
    return { staged: await run(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate, input), rendered }
  }
  const first = await makeCandidate('first-v1')
  const decision = { documentId: 'model', revisionId: first.staged.revision.id }
  await expect(run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, decision)).rejects.toThrow('fixture interruption')
  const accepted = await run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, decision)
  expect(commits[1].value.idempotentReplay).toBe(true)
  expect(accepted.revision.versionRef.accessPolicy).toEqual(policy)
  expect(commits[0].value.versions).toHaveLength(3)
  const firstRef = accepted.revision.versionRef
  const version = await invoke(ids.read, { versionId: firstRef.versionId })
  const receiptRef = version.value.version.dependencies.find((d: any) => d.role === 'model-execution').target
  const receiptBefore = await invoke(ids.read, { versionId: receiptRef.versionId })
  expect(await readFile(sourcePath)).toEqual(original)
  expect(accepted.document.artifact.manifestPath).toBeUndefined()
  const acceptedPath = accepted.document.artifact.sourcePath
  expect(acceptedPath).not.toBe(sourcePath)
  await writeFile(join(root, 'changed-preview.png'), 'overwritten-path')
  const exactImage = await run(VISUAL_REVIEW_CAPABILITY_IDS.readImage, { path: sourcePath, versionRef: firstRef, expectedHash: firstRef.contentDigest })
  expect(exactImage.dataUrl).toBe('data:image/png;base64,' + generated.toString('base64'))
  await expect(run(VISUAL_REVIEW_CAPABILITY_IDS.readImage, { path: join(root, 'changed-preview.png'), expectedHash: firstRef.contentDigest })).rejects.toThrow('digest mismatch')
  expect(await readFile(sourcePath)).toEqual(original)
  await writeFile(first.rendered.manifestPath, '{"overwritten":true}')
  await writeFile(first.rendered.modelExecution.requestCapture!.references[0]!.snapshotPath!, 'overwritten')
  const second = await makeCandidate('second-v2', acceptedPath)
  await run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { documentId: 'model', revisionId: second.staged.revision.id })
  const opened = visualReviewOpenOutputSchema.parse(await run(VISUAL_REVIEW_CAPABILITY_IDS.readDocument, { documentId: 'model' }))
  expect(opened.document.revisions).toHaveLength(2)
  expect(opened.document.revisions[0]!.versionRef).toEqual(firstRef)
  expect((await invoke(ids.read, { versionId: receiptRef.versionId })).value.dataBase64).toEqual(receiptBefore.value.dataBase64)
  const html = renderToStaticMarkup(createElement(ModelSourceDetails, { document: opened.document }))
  expect(html).toContain('调整颜色')
  expect(html).toContain('Seed was not supplied')
  expect(html).not.toContain('Python')
  await writeFile(join(root, 'source-ui.html'), html)
  const unknownPath = join(root, '未登记参考.png')
  await writeFile(unknownPath, generated) // Same bytes as the bound image, different semantic input path.
  const unknown = await makeCandidate('unknown-policy', unknownPath)
  await expect(run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { documentId: 'model', revisionId: unknown.staged.revision.id })).rejects.toThrow('permission is unknown')
  expect(commits).toHaveLength(3)
  await run(VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate, { documentId: 'model', revisionId: unknown.staged.revision.id })
  const tampered = await makeCandidate('tampered-input', opened.document.artifact!.sourcePath)
  await writeFile(tampered.staged.revision.modelSource.request.references[0].snapshotPath, 'tampered')
  await expect(run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { documentId: 'model', revisionId: tampered.staged.revision.id })).rejects.toThrow('input digest mismatch')
  expect(commits).toHaveLength(3)
  await run(VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate, { documentId: 'model', revisionId: tampered.staged.revision.id })
  const stale = await makeCandidate('concurrent-candidate', opened.document.artifact!.sourcePath)
  const latestRef = opened.document.artifact!.versionRef!
  const advanced = await invoke(ids.commit, { idempotencyKey: 'external-cas-advance', candidates: [{ candidateId: 'advance', artifactId: latestRef.artifactId, expectedCurrentVersionId: latestRef.versionId, kind: 'figure', intent: 'save', content: { mode: 'snapshot', dataBase64: generated.toString('base64'), mediaType: 'image/png' }, accessPolicy: policy }] })
  expect(advanced.ok).toBe(true)
  await expect(run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { documentId: 'model', revisionId: stale.staged.revision.id })).rejects.toThrow('requires the bound ArtifactVersion to be current')
  expect(commits).toHaveLength(3)
  expect(await readFile(sourcePath)).toEqual(original)
  expect(await readFile(acceptedPath)).toEqual(generated)
  // A public image must not expose a pending candidate's separately restricted input.
  const publicVersion = await invoke(ids.commit, { idempotencyKey: 'public-image', candidates: [{ candidateId: 'public', expectedCurrentVersionId: null, kind: 'figure', intent: 'save', content: { mode: 'snapshot', dataBase64: generated.toString('base64'), mediaType: 'image/png' }, accessPolicy: { visibility: 'workspace', principals: [], allowExport: true } }] })
  expect(publicVersion.ok).toBe(true)
  await run(VISUAL_REVIEW_CAPABILITY_IDS.open, { documentId: 'public-with-private-input', artifact: { kind: 'generated_image', sourcePath: unknownPath, versionRef: publicVersion.value.versions[0].ref, mimeType: 'image/png' } })
  await makeCandidate('private-input-candidate', acceptedPath, 'public-with-private-input', [firstRef])
  callerId = 'denied-reader'
  await expect(run(VISUAL_REVIEW_CAPABILITY_IDS.readDocument, { documentId: 'public-with-private-input' })).rejects.toThrow(/verification failed/)
  callerId = 'denied-reader'
  await expect(run(VISUAL_REVIEW_CAPABILITY_IDS.readDocument, { documentId: 'model' })).rejects.toThrow(/verification failed/)
  callerId = 'reviewer'
  const restrictedBase = await invoke(ids.commit, { idempotencyKey: 'intersection-base', candidates: [{
    candidateId: 'base', expectedCurrentVersionId: null, kind: 'figure', intent: 'save',
    content: { mode: 'snapshot', dataBase64: original.toString('base64'), mediaType: 'image/png' },
    accessPolicy: { visibility: 'restricted', principals: ['reviewer', 'base-reader'], allowExport: true }
  }] })
  const restrictedInput = await invoke(ids.commit, { idempotencyKey: 'intersection-input', candidates: [{
    candidateId: 'input', expectedCurrentVersionId: null, kind: 'figure', intent: 'save',
    content: { mode: 'snapshot', dataBase64: original.toString('base64'), mediaType: 'image/png' },
    accessPolicy: { visibility: 'restricted', principals: ['reviewer', 'input-reader'], allowExport: false }
  }] })
  const inputPath = join(root, 'separate-semantic-input.png')
  await writeFile(inputPath, original)
  await run(VISUAL_REVIEW_CAPABILITY_IDS.open, { documentId: 'intersection', artifact: {
    kind: 'generated_image', sourcePath, versionRef: restrictedBase.value.versions[0].ref, mimeType: 'image/png'
  } })
  await run(VISUAL_REVIEW_CAPABILITY_IDS.updateContext, { documentId: 'intersection', nodes: ['node-a', 'node-b'].map((id) => ({
    id, kind: 'shape', bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 }, editable: true, truthLocked: false
  })) })
  const intersection = await makeCandidate('intersect-permissions', inputPath, 'intersection', [restrictedInput.value.versions[0].ref])
  await run(VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations, { documentId: 'intersection', annotations: [{
    id: 'targeted-pin', geometry: { kind: 'pin', point: { x: 0.2, y: 0.3 } }, instruction: 'Keep targets', targetNodeIds: ['node-a', 'node-b']
  }] })
  const intersected = await run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { documentId: 'intersection', revisionId: intersection.staged.revision.id })
  expect(intersected.revision.versionRef.accessPolicy).toEqual({ visibility: 'restricted', principals: ['reviewer'], allowExport: false })
  expect(intersected.document.annotations[0].targetNodeIds).toEqual(['node-a', 'node-b'])
  expect(await readFile(sourcePath)).toEqual(original)
  expect((await invoke(ids.read, { versionId: baseRef.versionId })).value.dataBase64).toBe(original.toString('base64'))
  // Exercise the real review packet path, which edits the owner-maintained working
  // copy and submits a generated mask; neither is an arbitrary equal-byte alias.
  await run(VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations, { documentId: 'intersection', annotations: [{
    id: 'masked-box', geometry: { kind: 'box', bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
    instruction: 'Adjust the selected region only', targetNodeIds: ['node-a', 'node-b']
  }] })
  const packet = await run(VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket, { documentId: 'intersection' })
  ctx.fillStyle = '#2a7'; ctx.fillRect(30, 30, 65, 65)
  providerOutput = canvas.toBuffer('image/png')
  const edited = await editImageFromVisualReviewPacket({ workspaceRoot: root, imageId: 'actual-review-packet',
    reviewPacketPath: packet.packetPath, visualPlan: { ...plan, sourceArtifacts: [packet.packet.sourceArtifact.workingCopyPath] } as never })
  if (!edited.ok) throw new Error(edited.message)
  expect(edited.intents[0]!.targetNodeIds).toEqual(['node-a', 'node-b'])
  const output = edited.outputs[0]!
  const maskedQa = await reviewImageGenerationCandidate({ workspaceRoot: root, outputPath: output.outputPath,
    manifestPath: output.manifestPath, task: 'check masked fixture', minOverall: 0 })
  if (!maskedQa.ok) throw new Error(maskedQa.message)
  const masked = await run(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate, { documentId: 'intersection',
    candidatePath: output.outputPath, summary: 'Actual packet candidate', reviewEvidence: { tool: 'image_generation_review_candidate', ...maskedQa } })
  expect(masked.revision.modelSource.request.references.map((ref: any) => ref.role)).toEqual(['image', 'mask'])
  const maskedAccepted = await run(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { documentId: 'intersection', revisionId: masked.revision.id })
  expect(maskedAccepted.revision.versionRef.accessPolicy).toEqual({ visibility: 'restricted', principals: ['reviewer'], allowExport: false })
  expect(commits.at(-1).value.versions).toHaveLength(4)
  expect(await readFile(sourcePath)).toEqual(original)
  const uiCandidate = await makeCandidate('ui-review-candidate', maskedAccepted.document.artifact.workingCopyPath, 'intersection')
  await exerciseReviewIframe({ workspaceRoot: root, documentId: 'intersection', outputDir: root, invoke: run })
  const afterUi = await run(VISUAL_REVIEW_CAPABILITY_IDS.readDocument, { documentId: 'intersection' })
  expect(afterUi.document.acceptedRevisionId).toBe(uiCandidate.staged.revision.id)
  expect(afterUi.document.activeCandidateRevisionId).toBeNull()
  expect(afterUi.document.annotations[0].targetNodeIds).toEqual(['node-a', 'node-b'])
  expect(await readFile(sourcePath)).toEqual(original)
  await dispose?.()
})
