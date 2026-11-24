import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDomainMainEntry as createArtifactVersionsMainEntry } from '@sciforge/domain-artifact-versions/main'
import {
  KNOWLEDGE_LIBRARY_CAPABILITY_IDS,
  KNOWLEDGE_NET_CAPABILITY_IDS,
  knowledgeAnnotateResultSchema,
  libraryImportResultSchema,
  libraryStatusResultSchema,
  knowledgeLookupResultSchema,
  knowledgeNoteCommitResultSchema,
  resourceCommitResultSchema, resourceSearchResultSchema, knowledgeResourceSchema
} from '@sciforge/domain-knowledge-net/contract'
import { createDomainMainEntry as createKnowledgeNetMainEntry } from '@sciforge/domain-knowledge-net/main'
import type { DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { domainExecutionEventSchema } from '@sciforge/domain-sdk/reproducibility'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { CapabilityBroker } from '../capabilities/broker'
import { defineCapability } from '../capabilities/registry'
import { createApplicationCapabilityRegistry } from './application-composition'
import { DomainModuleCatalog } from './catalog'
import {
  activateMainRuntimeContributions,
  createMainSystemCapabilityInvokerFactory
} from './runtime-contributions'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  ))
})

function unavailableCoreDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies
}

const RECORD = {
  schemaVersion: 1 as const,
  paperId: 'hasson-2002',
  concepts: [{
    term: '偏心度偏置',
    definition: '皮层对不同视网膜偏心度的刺激响应不均（eccentricity bias）。'
  }],
  conceptTargets: [{ term: 'RSA' }]
}

describe('installed Knowledge Net domain', () => {
  it('persists resource CAS, replay, independent duplicate candidates and evidence through real Broker storage', async () => {
    const fixture = await createFixture()
    const agent = { audience: 'agent' as const, callerId: 'agent:resource-test', workspaceId: fixture.workspaceRoot }
    let broker = fixture.rebuiltBroker
    let sequence = 0
    const invoke = async (actionId: string, input: unknown) => broker.invoke(agent, { actionId, invocationId: `resource-${++sequence}`, input } as never)
    const resource = knowledgeResourceSchema.parse({ schemaVersion: 1, name: 'Synthetic resource', aliases: [],
      identifiers: [{ scheme: 'doi', value: '10.1234/acceptance' }], description: 'Integration test fixture', dataTypes: ['image'],
      processingLevel: 'raw', locations: [], access: { mode: 'unknown', evidenceIds: [] }, paperLinks: [], evidence: [], checks: [] })
    const commit = async (input: unknown) => resourceCommitResultSchema.parse((await invoke('knowledge-net.resource.commit', input)).output)
    let activated = fixture.activated
    try {
      const initialInput = { operationId: 'resource-create-0001', expectedVersionId: null, resource }
      const first = await commit(initialInput)
      const duplicate = await commit({ ...initialInput, operationId: 'resource-create-0002' })
      expect(duplicate.resourceId).not.toBe(first.resourceId)
      const baseline = { resourceId: first.resourceId, expectedVersionId: first.versionId }
      const inputs = ['A', 'B'].map((name) => ({ ...baseline, operationId: `resource-update-${name}`, resource: { ...resource, name } }))
      const concurrent = await Promise.allSettled(inputs.map((input) => invoke('knowledge-net.resource.commit', input)))
      const winnerIndex = concurrent.findIndex((result) => result.status === 'fulfilled')
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const loser = concurrent[1 - winnerIndex]!
      expect(loser.status === 'rejected' ? String(loser.reason) : '').toContain('stale_base')
      const won = concurrent[winnerIndex]!
      if (won.status !== 'fulfilled') throw new Error('No update succeeded')
      const winner = resourceCommitResultSchema.parse(won.value.output)
      expect(await commit(inputs[winnerIndex])).toEqual(winner)
      await expect(invoke('knowledge-net.resource.commit', { ...inputs[winnerIndex], resource: { ...resource, name: 'Changed replay' } })).rejects.toThrow(/idempotency_conflict|already used with a different request/)
      const search = resourceSearchResultSchema.parse((await invoke('knowledge-net.resource.search', {})).output)
      expect(search.resources).toHaveLength(2)
      expect(search.duplicateCandidates).toHaveLength(1)
      expect(search.derivedFrom.coverage).toBe('complete')
      await activated.dispose()
      const restarted = await createFixture(fixture.userDataDir)
      activated = restarted.activated
      broker = restarted.rebuiltBroker
      expect(await commit(inputs[winnerIndex])).toEqual(winner)
      expect(await commit(initialInput)).toEqual(first)
      const readback = resourceSearchResultSchema.parse((await invoke('knowledge-net.resource.search', { resourceId: first.resourceId })).output)
      expect(readback.resources[0]?.versionId).toBe(winner.versionId)
      expect(readback.resources[0]?.resource.name).toBe(inputs[winnerIndex]!.resource.name)
    } finally { await activated.dispose() }
  })
  it('seals a record and answers lookup and annotate through the production registry and broker', async () => {
    const { rebuiltBroker, activated, workspaceRoot } = await createFixture()
    try {
      const agent = { audience: 'agent' as const, callerId: 'agent:knowledge-net-test', workspaceId: workspaceRoot }

      const committed = knowledgeNoteCommitResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.noteCommit,
        invocationId: 'kn-commit-1',
        input: { operationId: 'kn-op-00000001', record: RECORD }
      } as never)).output)
      expect(committed.contentDigest).toMatch(/^[a-f0-9]{64}$/u)

      const hit = knowledgeLookupResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.lookup,
        invocationId: 'kn-lookup-hit',
        input: { query: 'eccentricity bias' }
      })).output)
      expect(hit.status).toBe('hit')
      expect(hit.concept).toMatchObject({
        term: '偏心度偏置', versionId: committed.versionId, contentDigest: committed.contentDigest
      })

      const gap = knowledgeLookupResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.lookup,
        invocationId: 'kn-lookup-gap',
        input: { query: 'RSA' }
      })).output)
      expect(gap.status).toBe('gap_unexcavated')

      const unknown = knowledgeLookupResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.lookup,
        invocationId: 'kn-lookup-unknown',
        input: { query: 'never seen' }
      })).output)
      expect(unknown.status).toBe('gap_unknown')

      const annotated = knowledgeAnnotateResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.annotate,
        invocationId: 'kn-annotate-1',
        input: { text: '本文用 RSA 检验偏心度偏置。' }
      })).output)
      expect(annotated.spans.map((span) => [span.term, span.status])).toEqual([
        ['RSA', 'unexcavated'], ['偏心度偏置', 'known']
      ])
      expect(annotated.derivedFrom.records).toBe(1)

      // Library: import a bibliography the workspace holds, then see which papers are read.
      await mkdir(join(workspaceRoot, 'refs'), { recursive: true })
      await writeFile(join(workspaceRoot, 'refs', 'lib.bib'), [
        '@article{hasson-2002, title={Eccentricity bias}, author={Hasson, Uri}, year={2002}}',
        '@article{cichy2014, title={Resolving object recognition}, author={Cichy, Radoslaw}, year={2014}, doi={10.1038/nn.3635}}'
      ].join('\n'))
      const imported = libraryImportResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryImport,
        invocationId: 'kn-import-1',
        input: { operationId: 'kn-lib-00000001', path: 'refs/lib.bib' }
      })).output)
      expect(imported).toMatchObject({ format: 'bibtex', imported: 2, skippedTotal: 0 })

      const status = libraryStatusResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryStatus,
        invocationId: 'kn-status-1',
        input: {}
      })).output)
      expect(status.counts).toEqual({ total: 2, read: 1, unread: 1, unknown: 0 })
      expect(status.papers.find((paper) => paper.paperId === 'cichy2014')).toMatchObject({
        state: 'unread', year: 2014, doi: '10.1038/nn.3635'
      })
      expect(status.papers.find((paper) => paper.paperId === 'hasson-2002')?.state).toBe('read')

      const unreadOnly = libraryStatusResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryStatus,
        invocationId: 'kn-status-2',
        input: { state: 'unread' }
      })).output)
      expect(unreadOnly.papers.map((paper) => paper.paperId)).toEqual(['cichy2014'])

    } finally {
      await activated.dispose()
    }
  })
  it('preserves independent conditional explanations and all reading targets through the Broker', async () => {
    const { rebuiltBroker, activated, workspaceRoot } = await createFixture()
    const agent = { audience: 'agent' as const, callerId: 'agent:knowledge-net-test', workspaceId: workspaceRoot }
    try {
      const committed = knowledgeNoteCommitResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.noteCommit, invocationId: 'kn-original-source',
        input: { operationId: 'kn-original-source', record: RECORD }
      } as never)).output)
      // Same concept from an independent note: neither conditions nor a contrary target disappear.
      const other = knowledgeNoteCommitResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.noteCommit, invocationId: 'kn-conditional-source',
        input: { operationId: 'kn-conditional-source', record: {
          schemaVersion: 1, paperId: 'independent-paper',
          concepts: [{ term: 'eccentricity bias', definition: 'Absent under condition B; contrary to condition A.' }],
          conceptTargets: [{ term: 'eccentricity bias' }, { term: 'RSA' }]
        } }
      } as never)).output)
      const multiple = knowledgeLookupResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.lookup, invocationId: 'kn-multiple', input: { query: 'eccentricity bias' }
      })).output)
      expect(multiple.status).toBe('multiple_sources')
      expect(multiple.concept).toBeUndefined()
      expect(new Set(multiple.matches.map((m) => m.concept.versionId))).toEqual(new Set([committed.versionId, other.versionId]))
      expect(multiple.derivedFrom.coverage).toBe('complete')
      const targets = knowledgeLookupResultSchema.parse((await rebuiltBroker.invoke(agent, {
        actionId: KNOWLEDGE_NET_CAPABILITY_IDS.lookup, invocationId: 'kn-all-targets', input: { query: 'RSA' }
      })).output)
      expect(targets.targets).toHaveLength(2)

    } finally {
      await activated.dispose()
    }
  })

})

async function createFixture(existingUserDataDir?: string) {
  const userDataDir = existingUserDataDir ?? await realpath(await mkdtemp(join(tmpdir(), 'sciforge-knowledge-net-composition-')))
  if (!existingUserDataDir) temporaryDirectories.push(userDataDir)
  const workspaceRoot = join(userDataDir, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  const domainHost = {
    getUserDataDir: () => userDataDir,
    defineCapability: (options: unknown) => defineCapability(options as never),
    textSanitizer: { sanitizeText: (value: string) => value }
  }
  const catalog = new DomainModuleCatalog()
  // Production binds each domain's system invoker to the one Broker; the Broker is built
  // from the catalog, so the invoker is bound after construction.
  const knowledgeNetOwner = Object.freeze({ moduleId: 'sciforge.knowledge-net', moduleVersion: createKnowledgeNetMainEntry(domainHost).definition.module.version })
  const bound: { invoker?: DomainMainSystemCapabilityInvoker } = {}
  const deferredInvoker: DomainMainSystemCapabilityInvoker = {
    invoke: (contract, input, options) => {
      if (!bound.invoker) throw new Error('Broker is not ready.')
      return bound.invoker.invoke(contract, input, options)
    },
    createApprovedBatch: (...args) => {
      if (!bound.invoker) throw new Error('Broker is not ready.')
      return bound.invoker.createApprovedBatch(...args)
    }
  }
  catalog.registerBatch([
    createArtifactVersionsMainEntry(domainHost),
    createKnowledgeNetMainEntry({ ...domainHost, capabilities: deferredInvoker } as never)
  ])
  const rebuiltBroker = new CapabilityBroker(
    createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
  )
  bound.invoker = createMainSystemCapabilityInvokerFactory(rebuiltBroker).forDomain(knowledgeNetOwner, [])
  const activated = await activateMainRuntimeContributions(catalog, {
    userDataDir,
    appRoot: '/app',
    environment: Object.freeze({ NODE_ENV: 'test' }),
    agentThreads: {
      list: async () => [],
      read: async () => { throw new Error('unused') },
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilityInvokers: createMainSystemCapabilityInvokerFactory(rebuiltBroker),
    modelAccess: { textReasoner: async () => null },
    executionEvents: {
      publish: async (owner, event) => domainExecutionEventSchema.parse({
        ...event,
        schemaVersion: 'sciforge.execution-event.v1' as const,
        eventId: event.eventId ?? 'execution-event-knowledge-net-test',
        producer: owner,
        occurredAt: event.occurredAt ?? '2099-08-11T08:00:00.000Z',
        artifacts: event.artifacts ?? []
      })
    },
    enablement: { isEnabled: async () => true, subscribe: () => () => undefined },
    log: () => undefined
  })

  return { rebuiltBroker, activated, workspaceRoot, userDataDir }
}
