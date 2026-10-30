import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { z } from 'zod'
import { VISUAL_REVIEW_CAPABILITY_IDS } from '../src/core/contract.js'
import { PLUGIN_CAPABILITY_DESCRIPTORS } from '../src/dsh-adapter/descriptors.js'
import {
  activate,
  dispose,
  getCapabilityDefinitions,
  setVisualReviewPorts
} from '../src/dsh-adapter/index.js'
import type { VisualReviewPorts } from '../src/ports/visual-review-ports.js'

const tempDirs: string[] = []
async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vr-plugin-unit-'))
  tempDirs.push(dir)
  return dir
}
test.afterEach(async () => {
  setVisualReviewPorts(undefined)
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Renders a real raster image through @napi-rs/canvas in this test process. */
async function renderPng(width = 96, height = 64): Promise<Buffer> {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#f4f1ea'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#274060'
  context.fillRect(width * 0.1, height * 0.2, width * 0.5, height * 0.4)
  context.fillStyle = '#c8a24b'
  context.beginPath()
  context.arc(width * 0.7, height * 0.6, height * 0.2, 0, Math.PI * 2)
  context.fill()
  return canvas.encode('png')
}

type Handler = (input: unknown) => Promise<{ output: any }>
function handlersById(): Map<string, Handler> {
  return new Map(getCapabilityDefinitions().map((definition) => [definition.descriptor.id, definition.handler as Handler]))
}

const EXPECTED_EFFECTS: Record<string, 'read' | 'workspace-write'> = {
  [VISUAL_REVIEW_CAPABILITY_IDS.open]: 'workspace-write',
  [VISUAL_REVIEW_CAPABILITY_IDS.readDocument]: 'read',
  [VISUAL_REVIEW_CAPABILITY_IDS.readImage]: 'read',
  [VISUAL_REVIEW_CAPABILITY_IDS.updateContext]: 'workspace-write',
  [VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference]: 'workspace-write',
  [VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations]: 'workspace-write',
  [VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket]: 'workspace-write',
  [VISUAL_REVIEW_CAPABILITY_IDS.createCandidate]: 'workspace-write',
  [VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate]: 'workspace-write',
  [VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate]: 'workspace-write'
}


test('descriptors mirror the static capability set: ids, workspace scope, workspace-write acceptance', () => {
  const ids = PLUGIN_CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.id).sort()
  assert.deepEqual(ids, Object.values(VISUAL_REVIEW_CAPABILITY_IDS).sort())
  for (const descriptor of PLUGIN_CAPABILITY_DESCRIPTORS) {
    assert.equal(descriptor.scope, 'workspace', `${descriptor.id} stays workspace-scoped`)
    assert.deepEqual(descriptor.resourceKinds, [], `${descriptor.id} declares no resource kinds`)
    assert.equal(descriptor.approval, 'none', `${descriptor.id} needs no approval channel`)
    assert.equal(descriptor.concurrency.revision, 'none', `${descriptor.id} uses service-level concurrency`)
    assert.equal(descriptor.effect, EXPECTED_EFFECTS[descriptor.id], `${descriptor.id} effect`)
    assert.equal(
      descriptor.concurrency.idempotency,
      descriptor.effect === 'read' ? 'none' : 'required',
      `${descriptor.id} idempotency`
    )
    assert.equal(descriptor.inputSchema.type, 'object', `${descriptor.id} publishes a JSON Schema input`)
    assert.deepEqual(descriptor.outputSchema, {}, `${descriptor.id} allows any JSON output`)
  }
  const accept = PLUGIN_CAPABILITY_DESCRIPTORS
    .find((descriptor) => descriptor.id === VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)!
  assert.equal(accept.effect, 'workspace-write', 'acceptCandidate is workspace-write pre-bridge, not destructive')
})

test('the published createCandidate input survives the host JSON Schema round trip with offset datetimes', () => {
  const descriptor = PLUGIN_CAPABILITY_DESCRIPTORS
    .find((item) => item.id === VISUAL_REVIEW_CAPABILITY_IDS.createCandidate)!
  const hostSide = z.fromJSONSchema(descriptor.inputSchema as never)
  const parsed = hostSide.safeParse({
    workspaceRoot: '/tmp/ws',
    documentId: 'doc-1',
    candidatePath: 'candidates/v2.png',
    summary: 'Improved contrast',
    reviewEvidence: {
      tool: 'image_generation_review_candidate',
      ok: true,
      reviewedArtifactPath: 'candidates/v2.png',
      reviewedArtifactHash: 'a'.repeat(64),
      reviewedAt: '2026-10-15T10:30:00+08:00',
      score: { overall: 0.9, dimensions: 0.8, nonEmpty: 1, background: 0.9, semantic: 1, warnings: [] },
      semantic: { pass: true, summary: 'Passes review', violations: [], repairInstructions: [] },
      repairable: false,
      warnings: []
    },
    expectedBaseHash: 'b'.repeat(64)
  })
  assert.ok(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues.slice(0, 3)))
})

test('open -> updateContext -> saveAnnotations round-trip against a canvas-rendered PNG', async () => {
  await activate()
  try {
    const workspaceRoot = await tempWorkspace()
    const figure = await renderPng()
    await writeFile(join(workspaceRoot, 'figure.png'), figure)
    const byId = handlersById()

    const opened = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.open)!({
      workspaceRoot,
      documentId: 'doc-1',
      artifact: { kind: 'generated_image', sourcePath: 'figure.png', title: 'Unit figure' }
    })
    assert.equal(opened.output.status, 'created')
    assert.equal(opened.output.document.artifact.sourceHash, sha256(figure))
    assert.equal(opened.output.document.artifact.workingCopyHash, sha256(figure))
    const rootNodeId: string = opened.output.document.nodes[0].id

    const updated = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.updateContext)!({
      workspaceRoot,
      documentId: 'doc-1',
      truthLocks: [{ id: 'lock-1', description: 'Keep axis labels unchanged', nodeIds: [rootNodeId] }]
    })
    assert.equal(updated.output.status, 'updated')
    assert.equal(updated.output.document.truthLocks.length, 1)

    const saved = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations)!({
      workspaceRoot,
      documentId: 'doc-1',
      annotations: [{
        geometry: { kind: 'box', bounds: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 } },
        instruction: 'Soften the background gradient',
        targetNodeIds: [rootNodeId]
      }]
    })
    assert.equal(saved.output.status, 'saved')
    assert.equal(saved.output.annotations.length, 1)

    const documentPath = join(workspaceRoot, '.sciforge', 'visual-documents', 'doc-1', 'document.json')
    const onDisk = JSON.parse(await readFile(documentPath, 'utf8'))
    assert.equal(onDisk.annotations.length, 1)
    assert.equal(onDisk.truthLocks.length, 1)
    assert.equal(onDisk.artifact.workingCopyHash, sha256(figure))

    const reread = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.readDocument)!({ workspaceRoot, documentId: 'doc-1' })
    assert.equal(reread.output.status, 'opened')
    assert.equal(reread.output.document.annotations.length, 1)

    const image = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.readImage)!({ workspaceRoot, path: 'figure.png' })
    assert.ok(image.output.dataUrl.startsWith('data:image/png;base64,'))
  } finally {
    await dispose()
  }
})

test('artifact-bound capabilities fail closed until the host ports bridge is injected', async () => {
  await activate()
  try {
    const workspaceRoot = await tempWorkspace()
    const figure = await renderPng()
    await writeFile(join(workspaceRoot, 'figure.png'), figure)
    const byId = handlersById()
    await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.open)!({
      workspaceRoot,
      documentId: 'doc-1',
      artifact: { kind: 'generated_image', sourcePath: 'figure.png' }
    })
    await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations)!({
      workspaceRoot,
      documentId: 'doc-1',
      annotations: [{
        geometry: { kind: 'pin', point: { x: 0.5, y: 0.5 } },
        instruction: 'Center the title'
      }]
    })

    await assert.rejects(
      () => byId.get(VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket)!({ workspaceRoot, documentId: 'doc-1' }),
      /Host ports bridge is not connected/
    )
    await assert.rejects(
      () => byId.get(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate)!({
        workspaceRoot,
        documentId: 'doc-1',
        candidatePath: 'figure.png',
        summary: 'n/a',
        reviewEvidence: {
          tool: 'image_generation_review_candidate',
          ok: true,
          reviewedArtifactPath: 'figure.png',
          reviewedArtifactHash: sha256(figure),
          reviewedAt: new Date().toISOString(),
          score: { overall: 1, dimensions: 1, nonEmpty: 1, background: 1, semantic: 1, warnings: [] },
          semantic: { pass: true, summary: 'ok', violations: [], repairInstructions: [] },
          repairable: false,
          warnings: []
        }
      }),
      /Host ports bridge is not connected/
    )
    await assert.rejects(
      () => byId.get(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)!({
        workspaceRoot,
        documentId: 'doc-1',
        revisionId: 'revision-missing'
      }),
      /Host ports bridge is not connected/
    )
    // open with an explicit artifact versionRef also needs the bridge.
    const versionRef = {
      artifactId: 'artifact:00000000-0000-0000-0000-000000000000',
      versionId: 'artifact-version:00000000-0000-0000-0000-000000000000',
      contentDigest: sha256(figure),
      byteLength: figure.length,
      mediaType: 'image/png',
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
    }
    await assert.rejects(
      () => byId.get(VISUAL_REVIEW_CAPABILITY_IDS.open)!({
        workspaceRoot,
        documentId: 'doc-2',
        artifact: { kind: 'generated_image', sourcePath: 'figure.png', versionRef }
      }),
      /Host ports bridge is not connected/
    )
  } finally {
    await dispose()
  }
})

function fakeCommitReceipt(candidate: any) {
  const dataBase64 = candidate.content?.mode === 'snapshot' ? candidate.content.dataBase64 : ''
  const bytes = Buffer.from(dataBase64, 'base64')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const now = new Date().toISOString()
  const transactionId = `artifact-commit:${randomUUID()}`
  const artifactId = `artifact:${randomUUID()}`
  const versionId = `artifact-version:${randomUUID()}`
  const accessPolicy = candidate.accessPolicy ?? { visibility: 'workspace', principals: [], allowExport: true }
  const mediaType = candidate.content?.mediaType
  const ref = {
    artifactId,
    versionId,
    contentDigest: digest,
    byteLength: bytes.length,
    ...(mediaType ? { mediaType } : {}),
    availability: 'available',
    retention: 'snapshot',
    accessPolicy
  }
  return {
    ok: true,
    value: {
      transactionId,
      committedAt: now,
      idempotentReplay: false,
      versions: [{
        candidateId: candidate.candidateId,
        artifact: {
          artifactId,
          kind: candidate.kind,
          createdAt: now,
          updatedAt: now,
          currentVersionId: versionId,
          versionCount: 1
        },
        version: {
          schemaVersion: 1,
          versionId,
          artifactId,
          sequence: 1,
          transactionId,
          createdAt: now,
          intent: candidate.intent,
          storage: {
            mode: 'snapshot',
            contentDigest: digest,
            byteLength: bytes.length,
            ...(mediaType ? { mediaType } : {})
          },
          dependencies: [],
          accessPolicy,
          metadata: candidate.metadata ?? {}
        },
        ref
      }],
      events: []
    }
  }
}

test('injected host ports drive exportReviewPacket, createCandidate and acceptCandidate end to end', async () => {
  await activate()
  try {
    const workspaceRoot = await tempWorkspace()
    const figure = await renderPng()
    const candidate = await renderPng(120, 80)
    await writeFile(join(workspaceRoot, 'figure.png'), figure)
    await writeFile(join(workspaceRoot, 'candidate.png'), candidate)
    const candidateHash = sha256(candidate)
    const byId = handlersById()

    const opened = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.open)!({
      workspaceRoot,
      documentId: 'doc-1',
      artifact: { kind: 'generated_image', sourcePath: 'figure.png', title: 'Unit figure' }
    })
    const rootNodeId: string = opened.output.document.nodes[0].id
    await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations)!({
      workspaceRoot,
      documentId: 'doc-1',
      annotations: [{
        geometry: { kind: 'box', bounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 } },
        instruction: 'Increase contrast',
        targetNodeIds: [rootNodeId]
      }]
    })

    const requests: any[] = []
    const fakePorts: VisualReviewPorts = {
      identity: { pluginId: '@sciforge/plugin-visual-review', version: '0.1.0', profileId: 'unit' },
      storageRoot: workspaceRoot,
      request: async (request) => {
        requests.push(request)
        if (request.operation === 'artifacts.commit') {
          return fakeCommitReceipt((request.input as any).candidates[0]) as any
        }
        throw new Error(`unexpected operation ${request.operation}`)
      },
      cancel: async () => ({ cancelled: true, quiescent: true })
    }
    setVisualReviewPorts(fakePorts)

    const exported = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket)!({
      workspaceRoot,
      documentId: 'doc-1'
    })
    assert.equal(exported.output.status, 'exported')
    const packetCommits = requests.filter((request) => request.operation === 'artifacts.commit')
    assert.equal(packetCommits.length, 1)
    assert.equal(packetCommits[0].protocol, 'sciforge-visual-review-ports.v1')
    assert.equal(packetCommits[0].identity.pluginId, '@sciforge/plugin-visual-review')
    assert.equal(packetCommits[0].input.candidates[0].kind, 'review-packet')
    assert.equal(packetCommits[0].input.candidates[0].intent, 'publish')
    assert.equal(exported.output.versionRef.contentDigest, sha256(await readFile(exported.output.packetPath)))

    const created = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate)!({
      workspaceRoot,
      documentId: 'doc-1',
      candidatePath: 'candidate.png',
      summary: 'Higher contrast revision',
      expectedBaseHash: sha256(figure),
      reviewEvidence: {
        tool: 'image_generation_review_candidate',
        ok: true,
        reviewedArtifactPath: 'candidate.png',
        reviewedArtifactHash: candidateHash,
        reviewedAt: new Date().toISOString(),
        score: { overall: 0.95, dimensions: 0.9, nonEmpty: 1, background: 0.95, semantic: 1, warnings: [] },
        semantic: { pass: true, summary: 'Passes visual review', violations: [], repairInstructions: [] },
        repairable: false,
        warnings: []
      }
    })
    assert.equal(created.output.status, 'candidate_created')
    assert.equal(created.output.revision.artifactHash, candidateHash)
    assert.equal(created.output.revision.width, 120)
    assert.equal(created.output.revision.height, 80)
    const revisionId: string = created.output.revision.id

    const accepted = await byId.get(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)!({
      workspaceRoot,
      documentId: 'doc-1',
      revisionId
    })
    assert.equal(accepted.output.status, 'accepted')
    assert.equal(accepted.output.document.acceptedRevisionId, revisionId)
    assert.equal(accepted.output.revision.versionRef.contentDigest, candidateHash)
    const acceptCommits = requests.filter((request) => request.operation === 'artifacts.commit')
    assert.equal(acceptCommits.length, 2, 'packet export + candidate acceptance both commit through the bridge')
    const acceptCommit = acceptCommits[1].input.candidates[0]
    assert.equal(acceptCommit.intent, 'save')
    assert.equal(acceptCommit.expectedCurrentVersionId, null)
    assert.equal(acceptCommit.metadata.revisionId, revisionId)

    // The workspace image was atomically replaced and the previous source preserved.
    const replaced = await readFile(join(workspaceRoot, 'figure.png'))
    assert.equal(sha256(replaced), candidateHash)
    assert.equal(accepted.output.document.artifact.sourceHash, candidateHash)
    assert.equal(accepted.output.document.artifact.workingCopyHash, candidateHash)
    const backupPath: string = accepted.output.revision.backupPath
    assert.ok(await access(backupPath).then(() => true, () => false), 'acceptance backup exists')
    assert.equal(sha256(await readFile(backupPath)), sha256(figure))
  } finally {
    await dispose()
  }
})

test('handlers reject a missing workspaceRoot and calls while the plugin is not active', async () => {
  await activate()
  try {
    const byId = handlersById()
    await assert.rejects(
      () => byId.get(VISUAL_REVIEW_CAPABILITY_IDS.open)!({ documentId: 'doc-1' }),
      /workspaceRoot/
    )
    await assert.rejects(
      () => byId.get(VISUAL_REVIEW_CAPABILITY_IDS.readImage)!({ workspaceRoot: '/tmp/x', path: 'notes.txt' }),
      /bounded raster images/i
    )
  } finally {
    await dispose()
  }
  const definitions = getCapabilityDefinitions()
  const open = definitions.find((definition) => definition.descriptor.id === VISUAL_REVIEW_CAPABILITY_IDS.open)!
  await assert.rejects(
    () => (open.handler as Handler)({ workspaceRoot: '/tmp/x', documentId: 'doc-1' }),
    /not active/
  )
})
