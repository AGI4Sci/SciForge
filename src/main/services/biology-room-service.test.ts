import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BIOLOGY_ROOM_MAX_TOTAL_ASSET_BYTES,
  BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES
} from '../../shared/biology-room'
import {
  BiologyRoomConflictError,
  BiologyRoomService
} from './biology-room-service'

const tempDirs: string[] = []

async function tempWorkspace(prefix = 'sciforge-biology-room-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function tbiIndex(referenceNames: string[]): Buffer {
  const names = Buffer.from(`${referenceNames.join('\0')}${referenceNames.length ? '\0' : ''}`, 'utf8')
  const bytes = Buffer.alloc(36 + names.length + referenceNames.length * 8)
  bytes.write('TBI\u0001', 0, 'latin1')
  bytes.writeInt32LE(referenceNames.length, 4)
  bytes.writeInt32LE(names.length, 32)
  names.copy(bytes, 36)
  let offset = 36 + names.length
  for (const _name of referenceNames) {
    bytes.writeInt32LE(0, offset)
    bytes.writeInt32LE(0, offset + 4)
    offset += 8
  }
  return bytes
}

function csiIndex(referenceNames: string[]): Buffer {
  const names = Buffer.from(`${referenceNames.join('\0')}${referenceNames.length ? '\0' : ''}`, 'utf8')
  const auxiliaryLength = 28 + names.length
  const bytes = Buffer.alloc(16 + auxiliaryLength + 4 + referenceNames.length * 4)
  bytes.write('CSI\u0001', 0, 'latin1')
  bytes.writeInt32LE(14, 4)
  bytes.writeInt32LE(5, 8)
  bytes.writeInt32LE(auxiliaryLength, 12)
  bytes.writeInt32LE(names.length, 16 + 24)
  names.copy(bytes, 16 + 28)
  let offset = 16 + auxiliaryLength
  bytes.writeInt32LE(referenceNames.length, offset)
  offset += 4
  for (const _name of referenceNames) {
    bytes.writeInt32LE(0, offset)
    offset += 4
  }
  return bytes
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('BiologyRoomService', () => {
  it('persists sources, revisions, audit events, hashes, and reference-linked tracks', async () => {
    const workspaceRoot = await tempWorkspace()
    const fastaPath = join(workspaceRoot, 'reference.fa')
    const gffPath = join(workspaceRoot, 'features.gff3')
    await writeFile(fastaPath, '>chr1 human chromosome\nACGTACGT\n', 'utf8')
    await writeFile(gffPath, '##gff-version 3\nchr1\ttest\tgene\t1\t4\t.\t+\t.\tID=gene1\n', 'utf8')
    const fastaBefore = await sha256(fastaPath)
    const gffBefore = await sha256(gffPath)

    const service = new BiologyRoomService()
    const room = await service.create({
      workspaceRoot,
      roomId: 'genome-room',
      title: 'Genome Room',
      assets: [
        { id: 'reference-1', path: 'reference.fa', asReference: true },
        { id: 'track-1', path: 'features.gff3' }
      ],
      actor: { kind: 'user', id: 'user-1', taskId: 'task-1' }
    })

    expect(room.revision).toBe(1)
    expect(room.assets.find((asset) => asset.id === 'reference-1')).toMatchObject({
      modality: 'genome-reference',
      contigs: [{ name: 'chr1', length: 8 }]
    })
    expect(room.assets.find((asset) => asset.id === 'track-1')?.referenceAssetId).toBe('reference-1')
    expect(room.assets.find((asset) => asset.id === 'reference-1')?.sha256).toBe(fastaBefore)

    const roomDirectory = join(workspaceRoot, '.sciforge/biology/rooms/genome-room')
    await expect(readFile(join(roomDirectory, 'room.json'), 'utf8')).resolves.toContain('"revision": 1')
    await expect(readFile(join(roomDirectory, 'revisions/1.json'), 'utf8')).resolves.toContain('"roomId": "genome-room"')
    const eventLines = (await readFile(join(roomDirectory, 'events.ndjson'), 'utf8')).trim().split('\n')
    expect(eventLines).toHaveLength(1)
    expect(JSON.parse(eventLines[0]!)).toMatchObject({ fromRevision: 0, toRevision: 1 })
    expect((await readdir(roomDirectory)).some((name) => name.includes('.tmp'))).toBe(false)
    expect(await sha256(fastaPath)).toBe(fastaBefore)
    expect(await sha256(gffPath)).toBe(gffBefore)
  })

  it('opens an unlinked track alone, then auto-links it when a single FASTA is added', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'features.bed'), 'chr1\t0\t4\n', 'utf8')
    await writeFile(join(workspaceRoot, 'reference.fna'), '>chr1\nACGT\n', 'utf8')
    const service = new BiologyRoomService()

    const first = await service.openOrCreate({ workspaceRoot, path: 'features.bed' })
    expect(first.created).toBe(true)
    expect(first.manifest.assets[0]).toMatchObject({ format: 'bed' })
    expect(first.manifest.assets[0]?.referenceAssetId).toBeUndefined()

    const reopened = await service.openOrCreate({ workspaceRoot, path: 'features.bed' })
    expect(reopened.created).toBe(false)
    expect(reopened.manifest.roomId).toBe(first.manifest.roomId)

    const linked = await service.apply({
      workspaceRoot,
      roomId: first.manifest.roomId,
      baseRevision: 1,
      operations: [{ type: 'addAsset', asset: { id: 'reference-1', path: 'reference.fna' } }]
    })
    expect(linked.manifest.assets.find((asset) => asset.format === 'bed')?.referenceAssetId).toBe('reference-1')
    expect(linked.manifest.assets.find((asset) => asset.id === 'reference-1')?.modality).toBe('genome-reference')
  })

  it('blocks direct room opening when the expected source digest does not match', async () => {
    const workspaceRoot = await tempWorkspace()
    const structurePath = join(workspaceRoot, 'protein.pdb')
    await writeFile(structurePath, 'HEADER    TEST STRUCTURE\nEND\n', 'utf8')
    const service = new BiologyRoomService()

    await expect(service.openOrCreate({
      workspaceRoot,
      path: 'protein.pdb',
      expectedSha256: '0'.repeat(64)
    })).rejects.toThrow(/integrity mismatch/)
    const expectedSha256 = await sha256(structurePath)
    await expect(service.openOrCreate({
      workspaceRoot,
      path: 'protein.pdb',
      expectedSha256
    })).resolves.toMatchObject({ created: true })

    await writeFile(structurePath, 'HEADER    CHANGED STRUCTURE\nEND\n', 'utf8')
    await expect(service.openOrCreate({
      workspaceRoot,
      path: 'protein.pdb',
      expectedSha256
    })).rejects.toThrow(/integrity mismatch/)
  })

  it('rejects zero-overlap track linking and reports partial contig mismatches', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'reference.fa'), '>chr1\nAAAA\n', 'utf8')
    await writeFile(join(workspaceRoot, 'bad.gff3'), 'chrX\ttest\tgene\t1\t2\t.\t+\t.\tID=x\n', 'utf8')
    await writeFile(
      join(workspaceRoot, 'partial.gff3'),
      'chr1\ttest\tgene\t1\t2\t.\t+\t.\tID=a\nchrX\ttest\tgene\t1\t2\t.\t+\t.\tID=b\n',
      'utf8'
    )
    const service = new BiologyRoomService()
    const badRoom = await service.create({
      workspaceRoot,
      roomId: 'bad-track',
      title: 'Bad track',
      assets: [{ id: 'track-bad', path: 'bad.gff3' }]
    })
    await expect(service.apply({
      workspaceRoot,
      roomId: badRoom.roomId,
      baseRevision: 1,
      operations: [{ type: 'addAsset', asset: { id: 'reference-bad', path: 'reference.fa' } }]
    })).rejects.toThrow(/no contig names matching/)
    expect((await service.load({ workspaceRoot, roomId: badRoom.roomId })).revision).toBe(1)

    const partialRoom = await service.create({
      workspaceRoot,
      roomId: 'partial-track',
      title: 'Partial track',
      assets: [{ id: 'track-partial', path: 'partial.gff3' }]
    })
    const result = await service.apply({
      workspaceRoot,
      roomId: partialRoom.roomId,
      baseRevision: 1,
      operations: [{ type: 'addAsset', asset: { id: 'reference-partial', path: 'reference.fa' } }]
    })
    expect(result.warnings.join('\n')).toMatch(/1 contig name.*chrX/)
    expect(result.manifest.assets.find((asset) => asset.id === 'track-partial')?.referenceCompatibility)
      .toMatchObject({
        status: 'partial',
        referenceAssetId: 'reference-partial',
        trackContigCount: 2,
        matchedContigCount: 1,
        unmatchedContigCount: 1,
        unmatchedExamples: ['chrX']
      })
    expect((await service.load({ workspaceRoot, roomId: partialRoom.roomId })).assets
      .find((asset) => asset.id === 'track-partial')?.referenceCompatibility?.unmatchedExamples)
      .toEqual(['chrX'])

    await writeFile(
      join(workspaceRoot, 'partial.gff3'),
      'chrX\ttest\tgene\t1\t2\t.\t+\t.\tID=only-x\n',
      'utf8'
    )
    const incompatible = await service.refresh({ workspaceRoot, roomId: partialRoom.roomId })
    expect(incompatible.warnings.join('\n')).toMatch(/no contig names matching/)
    expect(incompatible.manifest.assets.find((asset) => asset.id === 'track-partial')?.referenceCompatibility)
      .toMatchObject({
        status: 'incompatible',
        matchedContigCount: 0,
        unmatchedContigCount: 1,
        unmatchedExamples: ['chrX']
      })
    await expect(service.apply({
      workspaceRoot,
      roomId: partialRoom.roomId,
      baseRevision: incompatible.revision,
      operations: [{
        type: 'setTrackReference',
        trackAssetId: 'track-partial',
        referenceAssetId: 'reference-partial'
      }]
    })).rejects.toThrow(/no contig names matching/)
  })

  it('supports dry-run, all interactive state operations, conflicts, deletion, and restore', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'sequence.fa'), '>seq1\nACGTACGT\n', 'utf8')
    await writeFile(join(workspaceRoot, 'structure.pdb'), 'HEADER TEST\nEND\n', 'utf8')
    const service = new BiologyRoomService()
    const created = await service.create({
      workspaceRoot,
      roomId: 'interactive-room',
      title: 'Interactive room',
      assets: [{ id: 'sequence-1', path: 'sequence.fa' }]
    })
    const now = '2026-07-11T00:00:00.000Z'
    await expect(service.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: 1,
      dryRun: true,
      operations: [{
        type: 'setViewport',
        viewport: {
          kind: 'sequence',
          state: {
            assetId: 'sequence-1',
            sequenceId: 'missing-record',
            mode: 'linear',
            showTranslations: false
          }
        }
      }]
    })).rejects.toThrow(/record not found/)
    const operations = [
      { type: 'addAsset' as const, asset: { id: 'structure-1', path: 'structure.pdb' } },
      { type: 'setActiveAsset' as const, assetId: 'structure-1' },
      {
        type: 'setSelection' as const,
        selection: { kind: 'sequence' as const, assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 1, end: 4 }] }
      },
      {
        type: 'setViewport' as const,
        viewport: {
          kind: 'sequence' as const,
          state: { assetId: 'sequence-1', sequenceId: 'seq1', mode: 'linear' as const, showTranslations: true }
        }
      },
      {
        type: 'setMolecularView' as const,
        state: { assetId: 'structure-1', representation: 'cartoon' as const, colorScheme: 'chain' as const }
      },
      {
        type: 'upsertAnnotation' as const,
        annotation: {
          id: 'annotation-1',
          anchor: { kind: 'sequence' as const, assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 1, end: 4 }] },
          body: 'Important motif',
          actor: { kind: 'agent' as const, id: 'untrusted-actor' },
          createdAt: now,
          updatedAt: now
        }
      }
    ]

    const dryRun = await service.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: 1,
      dryRun: true,
      operations,
      actor: { kind: 'user', id: 'user-1' }
    })
    expect(dryRun).toMatchObject({ dryRun: true, changed: true, previousRevision: 1, revision: 2 })
    expect((await service.load({ workspaceRoot, roomId: created.roomId })).revision).toBe(1)

    const committed = await service.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: 1,
      operations,
      actor: { kind: 'user', id: 'user-1' }
    })
    expect(committed.manifest.annotations[0]?.actor).toEqual({ kind: 'user', id: 'user-1' })
    expect(committed.manifest.viewerStates.sequence?.sequenceId).toBe('seq1')
    expect(committed.manifest.viewerStates.molecular?.assetId).toBe('structure-1')
    const auditEvents = (await readFile(
      join(workspaceRoot, '.sciforge/biology/rooms/interactive-room/events.ndjson'),
      'utf8'
    )).trim().split('\n').map((line) => JSON.parse(line) as {
      operations: Array<{ type: string; annotation?: (typeof committed.manifest.annotations)[number] }>
    })
    const auditedAnnotation = auditEvents[1]?.operations
      .find((operation) => operation.type === 'upsertAnnotation')?.annotation
    expect(auditedAnnotation).toEqual(committed.manifest.annotations[0])
    expect(auditedAnnotation?.actor).toEqual({ kind: 'user', id: 'user-1' })
    await expect(service.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: 1,
      operations: [{ type: 'setActiveAsset', assetId: 'sequence-1' }]
    })).rejects.toBeInstanceOf(BiologyRoomConflictError)

    const removed = await service.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: 2,
      operations: [
        { type: 'deleteAnnotation', annotationId: 'annotation-1' },
        { type: 'removeAsset', assetId: 'structure-1' }
      ]
    })
    expect(removed.revision).toBe(3)
    expect(removed.manifest.annotations).toEqual([])

    const restored = await service.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: 3,
      operations: [{ type: 'restoreRevision', revision: 2 }]
    })
    expect(restored.revision).toBe(4)
    expect(restored.manifest.annotations[0]?.body).toBe('Important motif')
    expect(restored.manifest.assets.some((asset) => asset.id === 'structure-1')).toBe(true)

    const history = await service.history({ workspaceRoot, roomId: created.roomId, limit: 10 })
    expect(history.entries.map((entry) => entry.revision)).toEqual([4, 3, 2, 1])
    expect(history.entries[0]?.event?.operations[0]?.type).toBe('restoreRevision')
  })

  it('serializes separate service instances so only one concurrent base revision can commit', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'sequence.fa'), '>seq1\nACGT\n', 'utf8')
    const uiService = new BiologyRoomService()
    const agentService = new BiologyRoomService()
    await uiService.create({
      workspaceRoot,
      roomId: 'concurrent-room',
      title: 'Concurrent room',
      assets: [{ id: 'sequence-1', path: 'sequence.fa' }]
    })
    const now = '2026-07-11T00:00:00.000Z'
    const applyAnnotation = (service: BiologyRoomService, id: string) => service.apply({
      workspaceRoot,
      roomId: 'concurrent-room',
      baseRevision: 1,
      operations: [{
        type: 'upsertAnnotation',
        annotation: {
          id,
          anchor: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 0, end: 2 }] },
          body: id,
          actor: { kind: 'user' },
          createdAt: now,
          updatedAt: now
        }
      }]
    })

    const results = await Promise.allSettled([
      applyAnnotation(uiService, 'annotation-ui'),
      applyAnnotation(agentService, 'annotation-agent')
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(BiologyRoomConflictError)
    const finalRoom = await uiService.load({ workspaceRoot, roomId: 'concurrent-room' })
    expect(finalRoom.revision).toBe(2)
    expect(finalRoom.annotations).toHaveLength(1)
    const events = (await readFile(
      join(workspaceRoot, '.sciforge/biology/rooms/concurrent-room/events.ndjson'),
      'utf8'
    )).trim().split('\n')
    expect(events).toHaveLength(2)
  })

  it('survives a hard multi-turn user/agent conflict and external feature invalidation', async () => {
    const workspaceRoot = await tempWorkspace()
    const referencePath = join(workspaceRoot, 'reference.fa')
    const trackPath = join(workspaceRoot, 'features.gff3')
    await writeFile(referencePath, '>chr1\nACGTACGT\n', 'utf8')
    await writeFile(trackPath, '##gff-version 3\nchr1\ttest\tgene\t1\t4\t.\t+\t.\tID=gene1\n', 'utf8')
    const referenceBefore = await sha256(referencePath)
    const trackBefore = await sha256(trackPath)
    const uiService = new BiologyRoomService()
    const agentService = new BiologyRoomService()
    const created = await uiService.create({
      workspaceRoot,
      roomId: 'multi-turn-stress',
      title: 'Multi-turn stress',
      assets: [
        { id: 'reference-1', path: 'reference.fa', asReference: true },
        { id: 'track-1', path: 'features.gff3' }
      ]
    })
    const selected = await uiService.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: 1,
      actor: { kind: 'user', taskId: 'task-user', turnId: 'turn-user-1' },
      operations: [{
        type: 'setSelection',
        selection: {
          kind: 'genomic',
          assetId: 'track-1',
          referenceAssetId: 'reference-1',
          refName: 'chr1',
          start: 0,
          end: 4,
          featureId: 'gene1'
        }
      }]
    })
    const observed = await agentService.observe({
      workspaceRoot,
      roomId: created.roomId
    })
    expect(observed.revision).toBe(2)
    expect(observed.selection).toMatchObject({ featureId: 'gene1' })

    const now = '2026-07-11T00:00:00.000Z'
    const annotated = await agentService.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: observed.revision,
      actor: { kind: 'agent', id: 'agent-1', taskId: 'task-agent', turnId: 'turn-agent-1' },
      operations: [{
        type: 'upsertAnnotation',
        annotation: {
          id: 'annotation-agent',
          anchor: observed.selection!,
          body: 'Agent-reviewed gene feature.',
          actor: { kind: 'user' },
          createdAt: now,
          updatedAt: now
        }
      }]
    })
    expect(annotated.manifest.annotations[0]?.actor).toMatchObject({
      kind: 'agent',
      taskId: 'task-agent',
      turnId: 'turn-agent-1'
    })
    await expect(uiService.apply({
      workspaceRoot,
      roomId: created.roomId,
      baseRevision: selected.revision,
      operations: [{ type: 'setTrackVisibility', trackAssetId: 'track-1', visible: false }]
    })).rejects.toBeInstanceOf(BiologyRoomConflictError)
    expect(await sha256(referencePath)).toBe(referenceBefore)
    expect(await sha256(trackPath)).toBe(trackBefore)

    await writeFile(trackPath, '##gff-version 3\nchr1\ttest\tgene\t5\t8\t.\t+\t.\tID=gene2\n', 'utf8')
    const refreshed = await uiService.refresh({
      workspaceRoot,
      roomId: created.roomId,
      actor: { kind: 'system' }
    })
    expect(refreshed.revision).toBe(4)
    expect(refreshed.manifest.selection).toBeUndefined()
    expect(refreshed.manifest.annotations[0]).toMatchObject({
      id: 'annotation-agent',
      orphaned: true
    })
  })

  it('recovers a staged transaction without exposing a failed mutation as committed', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'sequence.fa'), '>seq1\nACGT\n', 'utf8')
    const service = new BiologyRoomService()
    await service.create({
      workspaceRoot,
      roomId: 'transaction-room',
      title: 'Transaction room',
      assets: [{ id: 'sequence-1', path: 'sequence.fa' }]
    })
    let failed = false
    const failingService = new BiologyRoomService({
      persistenceFaultInjector: (point) => {
        if (!failed && point === 'afterEventLog') {
          failed = true
          throw new Error('simulated event/canonical boundary failure')
        }
      }
    })
    await expect(failingService.apply({
      workspaceRoot,
      roomId: 'transaction-room',
      baseRevision: 1,
      operations: [{ type: 'setActiveAsset', assetId: null }]
    })).rejects.toThrow(/simulated/)

    const roomDirectory = join(workspaceRoot, '.sciforge/biology/rooms/transaction-room')
    expect(JSON.parse(await readFile(join(roomDirectory, 'room.json'), 'utf8')).revision).toBe(1)
    await expect(readFile(join(roomDirectory, 'transaction.json'), 'utf8')).resolves.toContain('"nextRevision": 2')
    await expect(readFile(join(roomDirectory, 'revisions/2.json'), 'utf8')).resolves.toContain('"revision": 2')

    const recovered = await new BiologyRoomService().load({ workspaceRoot, roomId: 'transaction-room' })
    expect(recovered.revision).toBe(1)
    expect(recovered.activeAssetId).toBe('sequence-1')
    await expect(readFile(join(roomDirectory, 'transaction.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(roomDirectory, 'revisions/2.json'), 'utf8')).rejects.toThrow()
    expect((await readFile(join(roomDirectory, 'events.ndjson'), 'utf8')).trim().split('\n')).toHaveLength(1)

    const retry = await new BiologyRoomService().apply({
      workspaceRoot,
      roomId: 'transaction-room',
      baseRevision: 1,
      operations: [{ type: 'setActiveAsset', assetId: null }]
    })
    expect(retry.revision).toBe(2)
  })

  it('refreshes external source changes, clears invalid selection, and orphans invalid annotations', async () => {
    const workspaceRoot = await tempWorkspace()
    const sourcePath = join(workspaceRoot, 'sequence.fa')
    await writeFile(sourcePath, '>seq1\nACGTACGT\n', 'utf8')
    const service = new BiologyRoomService()
    await service.create({
      workspaceRoot,
      roomId: 'refresh-room',
      title: 'Refresh room',
      assets: [{ id: 'sequence-1', path: 'sequence.fa' }]
    })
    const now = '2026-07-11T00:00:00.000Z'
    await service.apply({
      workspaceRoot,
      roomId: 'refresh-room',
      baseRevision: 1,
      operations: [
        {
          type: 'setSelection',
          selection: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 4, end: 8 }] }
        },
        {
          type: 'upsertAnnotation',
          annotation: {
            id: 'annotation-1',
            anchor: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 4, end: 8 }] },
            body: 'Tail motif',
            actor: { kind: 'user' },
            createdAt: now,
            updatedAt: now
          }
        }
      ]
    })
    const oldHash = (await service.load({ workspaceRoot, roomId: 'refresh-room' })).assets[0]!.sha256

    await writeFile(sourcePath, '>seq1\nACGT\n', 'utf8')
    const refreshed = await service.refresh({
      workspaceRoot,
      roomId: 'refresh-room',
      actor: { kind: 'system', id: 'file-watcher' }
    })
    expect(refreshed).toMatchObject({ changed: true, previousRevision: 2, revision: 3 })
    expect(refreshed.manifest.assets[0]?.sha256).not.toBe(oldHash)
    expect(refreshed.manifest.assets[0]?.contigs).toEqual([{ name: 'seq1', length: 4 }])
    expect(refreshed.manifest.selection).toBeUndefined()
    expect(refreshed.manifest.annotations[0]?.orphaned).toBe(true)
    expect(refreshed.warnings.join('\n')).toMatch(/selection was cleared/)

    const restored = await service.apply({
      workspaceRoot,
      roomId: 'refresh-room',
      baseRevision: 3,
      operations: [{ type: 'restoreRevision', revision: 2 }]
    })
    expect(restored.revision).toBe(4)
    expect(restored.manifest.assets[0]?.sha256).toBe(refreshed.manifest.assets[0]?.sha256)
    expect(restored.manifest.assets[0]?.contigs).toEqual([{ name: 'seq1', length: 4 }])
    expect(restored.manifest.selection).toBeUndefined()
    expect(restored.manifest.annotations[0]?.orphaned).toBe(true)

    const unchanged = await service.refresh({ workspaceRoot, roomId: 'refresh-room' })
    expect(unchanged).toMatchObject({ changed: false, revision: 4 })
    const history = await service.history({ workspaceRoot, roomId: 'refresh-room' })
    expect(history.entries.some((entry) => entry.event?.operations[0]?.type === 'refreshAssets')).toBe(true)
  })

  it('orphans anchors when an explicit sequence record disappears during refresh', async () => {
    const workspaceRoot = await tempWorkspace()
    const sourcePath = join(workspaceRoot, 'sequence.fa')
    await writeFile(sourcePath, '>old-record\nACGT\n', 'utf8')
    const service = new BiologyRoomService()
    await service.create({
      workspaceRoot,
      roomId: 'renamed-record-room',
      title: 'Renamed record',
      assets: [{ id: 'sequence-1', path: 'sequence.fa' }]
    })
    const now = '2026-07-11T00:00:00.000Z'
    await service.apply({
      workspaceRoot,
      roomId: 'renamed-record-room',
      baseRevision: 1,
      operations: [
        {
          type: 'setSelection',
          selection: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'old-record', ranges: [{ start: 0, end: 2 }] }
        },
        {
          type: 'upsertAnnotation',
          annotation: {
            id: 'old-anchor',
            anchor: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'old-record', ranges: [{ start: 0, end: 2 }] },
            body: 'Old record anchor',
            actor: { kind: 'user' },
            createdAt: now,
            updatedAt: now
          }
        }
      ]
    })
    await writeFile(sourcePath, '>new-record\nACGT\n', 'utf8')
    const refreshed = await service.refresh({ workspaceRoot, roomId: 'renamed-record-room' })
    expect(refreshed.manifest.selection).toBeUndefined()
    expect(refreshed.manifest.annotations[0]?.orphaned).toBe(true)
    expect(refreshed.warnings.join('\n')).toMatch(/Sequence record not found: old-record/)
  })

  it('persists missing source readiness and invalidates dependent room anchors', async () => {
    const workspaceRoot = await tempWorkspace()
    const sourcePath = join(workspaceRoot, 'sequence.fa')
    await writeFile(sourcePath, '>seq1\nACGT\n', 'utf8')
    const service = new BiologyRoomService()
    await service.create({
      workspaceRoot,
      roomId: 'missing-source-room',
      title: 'Missing source',
      assets: [{ id: 'sequence-1', path: 'sequence.fa' }]
    })
    const now = '2026-07-11T00:00:00.000Z'
    await service.apply({
      workspaceRoot,
      roomId: 'missing-source-room',
      baseRevision: 1,
      operations: [
        {
          type: 'setSelection',
          selection: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 0, end: 2 }] }
        },
        {
          type: 'upsertAnnotation',
          annotation: {
            id: 'missing-anchor',
            anchor: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 0, end: 2 }] },
            body: 'Missing source anchor',
            actor: { kind: 'user' },
            createdAt: now,
            updatedAt: now
          }
        }
      ]
    })
    await rm(sourcePath)
    const refreshed = await service.refresh({ workspaceRoot, roomId: 'missing-source-room' })
    expect(refreshed).toMatchObject({ changed: true, previousRevision: 2, revision: 3 })
    expect(refreshed.manifest.assets[0]).toMatchObject({
      readiness: 'missing'
    })
    expect(refreshed.manifest.assets[0]?.readinessError).toMatch(/File not found/)
    expect(refreshed.manifest.selection).toBeUndefined()
    expect(refreshed.manifest.annotations[0]?.orphaned).toBe(true)
    const reloaded = await new BiologyRoomService().load({ workspaceRoot, roomId: 'missing-source-room' })
    expect(reloaded.assets[0]?.readiness).toBe('missing')
  })

  it('conservatively orphans identity-based track and molecular anchors after source changes', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'reference.fa'), '>chr1\nAAAA\n', 'utf8')
    await writeFile(join(workspaceRoot, 'features.bed'), 'chr1\t0\t2\n', 'utf8')
    await writeFile(join(workspaceRoot, 'structure.pdb'), 'HEADER FIRST\nEND\n', 'utf8')
    const service = new BiologyRoomService()
    await service.create({
      workspaceRoot,
      roomId: 'identity-anchor-room',
      title: 'Identity anchors',
      assets: [
        { id: 'reference-1', path: 'reference.fa', asReference: true },
        { id: 'track-1', path: 'features.bed' },
        { id: 'structure-1', path: 'structure.pdb' }
      ]
    })
    const now = '2026-07-11T00:00:00.000Z'
    await service.apply({
      workspaceRoot,
      roomId: 'identity-anchor-room',
      baseRevision: 1,
      operations: [
        {
          type: 'upsertAnnotation',
          annotation: {
            id: 'feature-anchor',
            anchor: {
              kind: 'genomic',
              assetId: 'track-1',
              referenceAssetId: 'reference-1',
              refName: 'chr1',
              start: 0,
              end: 2,
              featureId: 'feature-1'
            },
            body: 'Feature identity',
            actor: { kind: 'user' },
            createdAt: now,
            updatedAt: now
          }
        },
        {
          type: 'upsertAnnotation',
          annotation: {
            id: 'coordinate-anchor',
            anchor: {
              kind: 'genomic',
              assetId: 'track-1',
              referenceAssetId: 'reference-1',
              refName: 'chr1',
              start: 0,
              end: 2
            },
            body: 'Coordinate only',
            actor: { kind: 'user' },
            createdAt: now,
            updatedAt: now
          }
        },
        {
          type: 'upsertAnnotation',
          annotation: {
            id: 'molecular-anchor',
            anchor: { kind: 'molecular', assetId: 'structure-1', locators: [{ chainId: 'A', residueNumber: 1 }] },
            body: 'Molecular identity',
            actor: { kind: 'user' },
            createdAt: now,
            updatedAt: now
          }
        }
      ]
    })
    await writeFile(join(workspaceRoot, 'features.bed'), 'chr1\t1\t3\n', 'utf8')
    await writeFile(join(workspaceRoot, 'structure.pdb'), 'HEADER SECOND\nEND\n', 'utf8')
    const refreshed = await service.refresh({ workspaceRoot, roomId: 'identity-anchor-room' })
    expect(refreshed.manifest.annotations.find((annotation) => annotation.id === 'feature-anchor')?.orphaned).toBe(true)
    expect(refreshed.manifest.annotations.find((annotation) => annotation.id === 'coordinate-anchor')?.orphaned).not.toBe(true)
    expect(refreshed.manifest.annotations.find((annotation) => annotation.id === 'molecular-anchor')?.orphaned).toBe(true)
  })

  it('assigns a reference to one specific track and validates its contigs', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'reference-a.fa'), '>chr1\nAAAA\n', 'utf8')
    await writeFile(join(workspaceRoot, 'reference-b.fa'), '>chr2\nCCCC\n', 'utf8')
    await writeFile(join(workspaceRoot, 'features.bed'), 'chr2\t0\t2\n', 'utf8')
    const service = new BiologyRoomService()
    const room = await service.create({
      workspaceRoot,
      roomId: 'targeted-reference-room',
      title: 'Targeted reference',
      assets: [
        { id: 'reference-a', path: 'reference-a.fa' },
        { id: 'reference-b', path: 'reference-b.fa' },
        { id: 'track-1', path: 'features.bed' }
      ]
    })
    expect(room.assets.find((asset) => asset.id === 'track-1')?.referenceAssetId).toBeUndefined()
    await expect(service.apply({
      workspaceRoot,
      roomId: room.roomId,
      baseRevision: 1,
      operations: [{ type: 'setTrackReference', trackAssetId: 'track-1', referenceAssetId: 'reference-a' }]
    })).rejects.toThrow(/no contig names matching/)
    const linked = await service.apply({
      workspaceRoot,
      roomId: room.roomId,
      baseRevision: 1,
      operations: [{ type: 'setTrackReference', trackAssetId: 'track-1', referenceAssetId: 'reference-b' }]
    })
    expect(linked.manifest.assets.find((asset) => asset.id === 'track-1')?.referenceAssetId).toBe('reference-b')
    expect(linked.manifest.assets.find((asset) => asset.id === 'reference-b')?.modality).toBe('genome-reference')
  })

  it('bounds observations without dropping source hashes or visible track state', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'reference.fa'), '>chr1\nAAAA\n>chr2\nCCCC\n', 'utf8')
    await writeFile(join(workspaceRoot, 'features.bed'), 'chr1\t0\t2\n', 'utf8')
    const service = new BiologyRoomService()
    const room = await service.create({
      workspaceRoot,
      roomId: 'observe-room',
      title: 'Observe room',
      assets: [
        { id: 'reference-1', path: 'reference.fa', asReference: true },
        { id: 'track-1', path: 'features.bed' }
      ]
    })
    await service.apply({
      workspaceRoot,
      roomId: room.roomId,
      baseRevision: 1,
      operations: [{ type: 'setTrackVisibility', trackAssetId: 'track-1', visible: false }]
    })
    const observed = await service.observe({
      workspaceRoot,
      roomId: room.roomId,
      assetLimit: 1,
      annotationLimit: 1,
      contigLimit: 1
    })
    expect(observed.assets).toHaveLength(1)
    expect(observed.assets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(observed.assets[0]?.contigs).toHaveLength(1)
    expect(observed.visibleTrackIds).not.toContain('track-1')
    expect(observed.truncated).toMatchObject({ assets: true, contigs: true })
  })

  it('rejects source and metadata symlink escapes', async () => {
    const workspaceRoot = await tempWorkspace()
    const outsideRoot = await tempWorkspace('sciforge-biology-outside-')
    await writeFile(join(outsideRoot, 'outside.fa'), '>outside\nAAAA\n', 'utf8')
    await symlink(join(outsideRoot, 'outside.fa'), join(workspaceRoot, 'linked.fa'))
    const service = new BiologyRoomService()
    await expect(service.create({
      workspaceRoot,
      roomId: 'escaped-source',
      title: 'Escaped source',
      assets: [{ path: 'linked.fa' }]
    })).rejects.toThrow(/within the selected workspace/)

    await writeFile(join(workspaceRoot, 'safe.fa'), '>safe\nAAAA\n', 'utf8')
    await rm(join(workspaceRoot, '.sciforge'), { recursive: true, force: true })
    await symlink(outsideRoot, join(workspaceRoot, '.sciforge'))
    await expect(service.create({
      workspaceRoot,
      roomId: 'escaped-metadata',
      title: 'Escaped metadata',
      assets: [{ path: 'safe.fa' }]
    })).rejects.toThrow(/within the selected workspace/)
  })

  it('enforces the unindexed and aggregate source size limits and discovers adjacent indexes', async () => {
    const workspaceRoot = await tempWorkspace()
    const tooLarge = join(workspaceRoot, 'too-large.fa')
    await writeFile(tooLarge, '')
    await truncate(tooLarge, BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES + 1)
    const service = new BiologyRoomService()
    await expect(service.create({
      workspaceRoot,
      roomId: 'large-unindexed',
      title: 'Large unindexed',
      assets: [{ path: 'too-large.fa' }]
    })).rejects.toThrow(/Unindexed Biology Room assets/)

    const assets: Array<{ path: string }> = []
    for (let index = 0; index < 4; index += 1) {
      const name = `indexed-${index}.fa`
      const path = join(workspaceRoot, name)
      await writeFile(path, '')
      await truncate(path, BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES)
      await writeFile(`${path}.fai`, `chr${index}\t${BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES}\t0\t60\t61\n`, 'utf8')
      assets.push({ path: name })
    }
    await writeFile(join(workspaceRoot, 'one-byte.fa'), '>')
    assets.push({ path: 'one-byte.fa' })
    await expect(service.create({
      workspaceRoot,
      roomId: 'aggregate-too-large',
      title: 'Aggregate too large',
      assets
    })).rejects.toThrow(`${BIOLOGY_ROOM_MAX_TOTAL_ASSET_BYTES} bytes total`)
  }, 20_000)

  it('requires structurally valid standard indexes for every compressed asset', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'reference.fa.gz'), Buffer.from('compressed-fasta-placeholder'))
    await writeFile(join(workspaceRoot, 'variants.vcf.gz'), Buffer.from('compressed-vcf-placeholder'))
    const service = new BiologyRoomService()

    await expect(service.create({
      workspaceRoot,
      roomId: 'compressed-fasta-no-index',
      title: 'Compressed FASTA',
      assets: [{ path: 'reference.fa.gz' }]
    })).rejects.toThrow(/requires both \.fai and \.gzi/)

    await writeFile(join(workspaceRoot, 'reference.fa.gz.fai'), 'chr1\t4\t0\t4\t5\n', 'utf8')
    await writeFile(join(workspaceRoot, 'reference.fa.gz.gzi'), Buffer.from('invalid'))
    await expect(service.create({
      workspaceRoot,
      roomId: 'compressed-fasta-invalid-index',
      title: 'Compressed FASTA invalid index',
      assets: [{ path: 'reference.fa.gz' }]
    })).rejects.toThrow(/Invalid GZI index/)

    await writeFile(join(workspaceRoot, 'reference.fa.gz.gzi'), Buffer.alloc(8))
    const fastaRoom = await service.create({
      workspaceRoot,
      roomId: 'compressed-fasta-indexed',
      title: 'Compressed FASTA indexed',
      assets: [{ path: 'reference.fa.gz' }]
    })
    expect(fastaRoom.assets[0]?.indexPaths).toEqual([
      'reference.fa.gz.fai',
      'reference.fa.gz.gzi'
    ])
    expect(fastaRoom.assets[0]?.indexFingerprints).toHaveLength(2)
    expect(fastaRoom.assets[0]?.indexFingerprints?.every((index) => /^[a-f0-9]{64}$/.test(index.sha256))).toBe(true)
    const sourceSha256 = fastaRoom.assets[0]!.sha256
    const originalGziSha256 = fastaRoom.assets[0]?.indexFingerprints
      ?.find((index) => index.path.endsWith('.gzi'))?.sha256
    const updatedGzi = Buffer.alloc(24)
    updatedGzi.writeBigUInt64LE(1n, 0)
    await writeFile(join(workspaceRoot, 'reference.fa.gz.gzi'), updatedGzi)
    const refreshedIndex = await service.refresh({ workspaceRoot, roomId: fastaRoom.roomId })
    expect(refreshedIndex).toMatchObject({ changed: true, previousRevision: 1, revision: 2 })
    expect(refreshedIndex.manifest.assets[0]?.sha256).toBe(sourceSha256)
    expect(refreshedIndex.manifest.assets[0]?.indexFingerprints
      ?.find((index) => index.path.endsWith('.gzi'))?.sha256).not.toBe(originalGziSha256)
    await rm(join(workspaceRoot, 'reference.fa.gz.gzi'))
    const missingIndex = await service.refresh({ workspaceRoot, roomId: fastaRoom.roomId })
    expect(missingIndex).toMatchObject({ changed: true, previousRevision: 2, revision: 3 })
    expect(missingIndex.manifest.assets[0]).toMatchObject({
      readiness: 'error',
      sha256: sourceSha256
    })
    expect(missingIndex.manifest.assets[0]?.readinessError).toMatch(/File not found.*\.gzi/)
    expect(missingIndex.manifest.assets[0]?.indexFingerprints?.map((index) => index.path))
      .toEqual(['reference.fa.gz.fai'])

    await expect(service.create({
      workspaceRoot,
      roomId: 'compressed-track-no-index',
      title: 'Compressed VCF',
      assets: [{ path: 'variants.vcf.gz' }]
    })).rejects.toThrow(/require a \.tbi or \.csi/)

    const truncatedTbi = tbiIndex(['chr1']).subarray(0, 41)
    await writeFile(join(workspaceRoot, 'variants.vcf.gz.tbi'), truncatedTbi)
    await expect(service.create({
      workspaceRoot,
      roomId: 'compressed-track-invalid-index',
      title: 'Compressed VCF invalid index',
      assets: [{ path: 'variants.vcf.gz' }]
    })).rejects.toThrow(/Invalid indexed reference metadata/)

    await writeFile(join(workspaceRoot, 'variants.vcf.gz.tbi'), tbiIndex([]))
    const trackRoom = await service.create({
      workspaceRoot,
      roomId: 'compressed-track-indexed',
      title: 'Compressed VCF indexed',
      assets: [{ path: 'variants.vcf.gz' }]
    })
    expect(trackRoom.assets[0]?.indexPaths).toEqual(['variants.vcf.gz.tbi'])
    expect(trackRoom.assets[0]?.indexFingerprints?.[0]?.path).toBe('variants.vcf.gz.tbi')
  })

  it('extracts TBI and CSI reference names for compressed-track compatibility checks', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'reference.fa'), '>chr1\nAAAA\n', 'utf8')
    await writeFile(join(workspaceRoot, 'zero-tbi.vcf.gz'), Buffer.from('compressed'))
    await writeFile(join(workspaceRoot, 'zero-tbi.vcf.gz.tbi'), gzipSync(tbiIndex(['chrX'])))
    await writeFile(join(workspaceRoot, 'partial.vcf.gz'), Buffer.from('compressed'))
    await writeFile(join(workspaceRoot, 'partial.vcf.gz.tbi'), gzipSync(tbiIndex(['chr1', 'chrX'])))
    await writeFile(join(workspaceRoot, 'zero-csi.vcf.gz'), Buffer.from('compressed'))
    await writeFile(join(workspaceRoot, 'zero-csi.vcf.gz.csi'), gzipSync(csiIndex(['chrY'])))
    const service = new BiologyRoomService()

    for (const [roomId, path] of [
      ['zero-tbi-room', 'zero-tbi.vcf.gz'],
      ['zero-csi-room', 'zero-csi.vcf.gz']
    ] as const) {
      await service.create({ workspaceRoot, roomId, title: roomId, assets: [{ id: 'track-1', path }] })
      await expect(service.apply({
        workspaceRoot,
        roomId,
        baseRevision: 1,
        operations: [{ type: 'addAsset', asset: { id: 'reference-1', path: 'reference.fa' } }]
      })).rejects.toThrow(/no contig names matching/)
    }

    await service.create({
      workspaceRoot,
      roomId: 'partial-index-room',
      title: 'Partial indexed track',
      assets: [{ id: 'track-1', path: 'partial.vcf.gz' }]
    })
    const partial = await service.apply({
      workspaceRoot,
      roomId: 'partial-index-room',
      baseRevision: 1,
      operations: [{ type: 'addAsset', asset: { id: 'reference-1', path: 'reference.fa' } }]
    })
    expect(partial.warnings.join('\n')).toMatch(/1 contig name.*chrX/)
    expect(partial.manifest.assets.find((asset) => asset.id === 'track-1')?.contigs).toEqual([
      { name: 'chr1' },
      { name: 'chrX' }
    ])
    expect(partial.manifest.assets.find((asset) => asset.id === 'track-1')?.referenceCompatibility)
      .toMatchObject({
        status: 'partial',
        matchedContigCount: 1,
        unmatchedContigCount: 1,
        unmatchedExamples: ['chrX']
      })
  })

  it('preflights serialized manifest size before staging an unreadable revision', async () => {
    const workspaceRoot = await tempWorkspace()
    await writeFile(join(workspaceRoot, 'sequence.fa'), '>seq1\nACGT\n', 'utf8')
    const service = new BiologyRoomService()
    const room = await service.create({
      workspaceRoot,
      roomId: 'manifest-limit-room',
      title: 'Manifest limit',
      assets: [{ id: 'sequence-1', path: 'sequence.fa' }]
    })
    const currentBytes = Buffer.byteLength(`${JSON.stringify(room, null, 2)}\n`, 'utf8')
    const constrainedService = new BiologyRoomService({ maxManifestBytes: currentBytes + 200 })
    const now = '2026-07-11T00:00:00.000Z'
    await expect(constrainedService.apply({
      workspaceRoot,
      roomId: room.roomId,
      baseRevision: 1,
      operations: [{
        type: 'upsertAnnotation',
        annotation: {
          id: 'large-annotation',
          anchor: { kind: 'sequence', assetId: 'sequence-1', sequenceId: 'seq1', ranges: [{ start: 0, end: 2 }] },
          body: 'x'.repeat(2_000),
          actor: { kind: 'user' },
          createdAt: now,
          updatedAt: now
        }
      }]
    })).rejects.toThrow(/manifest would exceed the readable limit/)
    const reloaded = await service.load({ workspaceRoot, roomId: room.roomId })
    expect(reloaded.revision).toBe(1)
    const roomDirectory = join(workspaceRoot, '.sciforge/biology/rooms/manifest-limit-room')
    await expect(readFile(join(roomDirectory, 'transaction.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(roomDirectory, 'revisions/2.json'), 'utf8')).rejects.toThrow()
  })
})
