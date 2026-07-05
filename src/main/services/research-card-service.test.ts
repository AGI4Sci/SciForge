import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResearchCardService } from './research-card-service'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-research-cards-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ResearchCardService', () => {
  it('creates, filters, updates, and archives research cards', async () => {
    const dataDir = await tempDir()
    const workspaceA = await tempDir()
    const workspaceB = await tempDir()
    const service = new ResearchCardService(dataDir)

    const source = await service.create({
      kind: 'source_triage',
      title: 'BioRxiv meiosis paper',
      workspaceRoot: workspaceA,
      tags: ['Meiosis', 'Literature'],
      sourceRefs: [{ kind: 'paper', id: 'doi:10.1101/example', label: 'Example preprint' }],
      createdFrom: { kind: 'paper_radar', id: 'paper-1' }
    })
    await service.create({
      kind: 'claim',
      title: 'SPO11 is a trigger-layer factor',
      workspaceRoot: workspaceB,
      status: 'needs_evidence',
      stage: 'evidence_needed'
    })

    expect(source).toMatchObject({
      kind: 'source_triage',
      status: 'open',
      stage: 'new',
      priority: 'normal',
      tags: ['meiosis', 'literature']
    })

    await expect(service.list({
      workspaceRoot: workspaceA,
      query: 'meiosis'
    })).resolves.toHaveLength(1)
    await expect(service.list({
      workspaceRoot: workspaceB,
      query: 'meiosis'
    })).resolves.toHaveLength(0)

    const accepted = await service.update({
      cardId: source.id,
      patch: {
        status: 'approved',
        stage: 'accepted',
        decision: {
          value: 'accept',
          reason: 'Directly relevant to the review scope.',
          decidedBy: 'pi',
          decidedAt: '2026-07-05T00:00:00.000Z'
        },
        nextAction: 'Route to hypothesis context'
      }
    })
    expect(accepted).toMatchObject({
      status: 'approved',
      stage: 'accepted',
      decision: { value: 'accept' },
      nextAction: 'Route to hypothesis context'
    })

    await service.archive({ cardId: source.id })
    await expect(service.list({ workspaceRoot: workspaceA })).resolves.toHaveLength(0)
    await expect(service.list({ workspaceRoot: workspaceA, includeArchived: true })).resolves.toHaveLength(1)
  })

  it('rejects stages that do not belong to the card kind', async () => {
    const dataDir = await tempDir()
    const service = new ResearchCardService(dataDir)

    await expect(service.create({
      kind: 'claim',
      title: 'Claim with source stage',
      stage: 'shortlisted'
    })).rejects.toThrow(/Invalid stage/)
  })

  it('does not follow a symlinked app-data research-card store target', async () => {
    const dataDir = await tempDir()
    const outsideDir = await tempDir()
    const outsideFile = join(outsideDir, 'cards.json')
    await mkdir(join(dataDir, 'research-cards'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(dataDir, 'research-cards', 'cards.json'))

    await expect(new ResearchCardService(dataDir).create({
      kind: 'next_action',
      title: 'Keep writes inside app data'
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
