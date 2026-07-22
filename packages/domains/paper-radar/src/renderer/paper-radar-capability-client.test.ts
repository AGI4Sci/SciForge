import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainRendererCapabilityContract,
  DomainRendererCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import { PAPER_RADAR_CAPABILITY_IDS } from '../contract'
import {
  createPaperRadarCapabilityClient,
  paperRadarCapabilityContracts
} from './paper-radar-capability-client'

test('uses the package contract action IDs with read and global mutation effects', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(paperRadarCapabilityContracts).map(
      ([key, contract]) => [key, { actionId: contract.actionId, effect: contract.effect }]
    )),
    {
      status: { actionId: PAPER_RADAR_CAPABILITY_IDS.status, effect: 'read' },
      syncArxiv: { actionId: PAPER_RADAR_CAPABILITY_IDS.syncArxiv, effect: 'external-write' },
      syncBiorxiv: { actionId: PAPER_RADAR_CAPABILITY_IDS.syncBiorxiv, effect: 'external-write' },
      syncProfile: { actionId: PAPER_RADAR_CAPABILITY_IDS.syncProfile, effect: 'external-write' },
      listProfiles: { actionId: PAPER_RADAR_CAPABILITY_IDS.listProfiles, effect: 'read' },
      saveProfile: { actionId: PAPER_RADAR_CAPABILITY_IDS.saveProfile, effect: 'external-write' },
      review: { actionId: PAPER_RADAR_CAPABILITY_IDS.review, effect: 'external-write' },
      search: { actionId: PAPER_RADAR_CAPABILITY_IDS.search, effect: 'read' },
      rank: { actionId: PAPER_RADAR_CAPABILITY_IDS.rank, effect: 'read' },
      digest: { actionId: PAPER_RADAR_CAPABILITY_IDS.digest, effect: 'read' }
    }
  )
})

test('reuses package schemas at the renderer capability boundary', () => {
  assert.equal(paperRadarCapabilityContracts.saveProfile.inputSchema.safeParse({
    name: 'default',
    keywords: [],
    excludeKeywords: [],
    arxivCategories: [],
    biorxivSubjects: []
  }).success, true)
  assert.equal(paperRadarCapabilityContracts.review.inputSchema.safeParse({
    profile: { name: '' }
  }).success, false)
})

test('adapts reads and confirmed mutations through the injected generic capability invoker', async () => {
  const calls: Array<{
    actionId: string
    input: unknown
    options?: { approval?: { mode: 'confirmation' } }
  }> = []
  const invoker: DomainRendererCapabilityInvoker = {
    invoke: async <TInput, TOutput>(
      contract: DomainRendererCapabilityContract<TInput, TOutput>,
      input: TInput,
      options?: { approval?: { mode: 'confirmation' } }
    ): Promise<TOutput> => {
      calls.push({ actionId: contract.actionId, input, ...(options ? { options } : {}) })
      return {
        ok: true,
        service: 'paper-radar'
      } as TOutput
    }
  }
  const client = createPaperRadarCapabilityClient(invoker)

  assert.deepEqual(await client.status(), { ok: true, service: 'paper-radar' })
  await client.saveProfile({
    name: 'default',
    keywords: [],
    excludeKeywords: [],
    arxivCategories: [],
    biorxivSubjects: []
  }, { approval: { mode: 'confirmation' } })
  assert.deepEqual(calls, [
    { actionId: PAPER_RADAR_CAPABILITY_IDS.status, input: {} },
    {
      actionId: PAPER_RADAR_CAPABILITY_IDS.saveProfile,
      input: {
        name: 'default',
        keywords: [],
        excludeKeywords: [],
        arxivCategories: [],
        biorxivSubjects: []
      },
      options: { approval: { mode: 'confirmation' } }
    }
  ])
})
