import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDomainMainEntry as createArtifactEntry } from '@sciforge/domain-artifact-versions/main'
import {
  ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
  ARTIFACT_VERSION_READ_CONTRACT,
  artifactVersionReadResultV1Schema
} from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { domainExecutionEventSchema } from '@sciforge/domain-sdk/reproducibility'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomainMainEntry as createReviewEntry } from '../../../packages/domains/review-control/src/main'
import { reviewReceiptCommitResultSchema } from '../../../packages/domains/review-control/src/contract'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { CapabilityBroker } from '../capabilities/broker'
import { defineCapability } from '../capabilities/registry'
import { createApplicationCapabilityRegistry } from './application-composition'
import { DomainModuleCatalog } from './catalog'
import { activateMainRuntimeContributions, createMainSystemCapabilityInvokerFactory } from './runtime-contributions'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const receipt = {
  artifactVersion: 'artifact-version:synthetic-reviewed-v7',
  actorHash: 'a'.repeat(64),
  openedAt: '2026-01-01T00:00:00Z',
  submittedAt: '2026-01-01T00:01:00Z',
  verdict: 'accepted'
}

async function fixture(options: { resolveCurrentPrincipal?: () => PrincipalSnapshot | null } = {}) {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'review-control-broker-')))
  directories.push(userDataDir)
  const workspace = join(userDataDir, 'workspace')
  await mkdir(workspace)
  const host = {
    getUserDataDir: () => userDataDir,
    defineCapability: (options: unknown) => defineCapability(options as never),
    textSanitizer: { sanitizeText: (value: string) => value }
  }
  let bound: DomainMainSystemCapabilityInvoker | undefined
  const deferred: DomainMainSystemCapabilityInvoker = {
    invoke: (contract, input, options) => {
      if (!bound) throw new Error('Broker not ready')
      return bound.invoke(contract, input, options)
    },
    createApprovedBatch: (...args) => {
      if (!bound) throw new Error('Broker not ready')
      return bound.createApprovedBatch(...args)
    }
  }
  const catalog = new DomainModuleCatalog()
  catalog.registerBatch([createArtifactEntry(host), createReviewEntry({ ...host, capabilities: deferred })])
  const dependencies = new Proxy({}, { get: () => () => undefined }) as AppCapabilityDependencies
  const broker = new CapabilityBroker(createApplicationCapabilityRegistry(catalog, dependencies), options)
  const invokers = createMainSystemCapabilityInvokerFactory(broker)
  bound = invokers.forDomain({ moduleId: 'sciforge.review-control', moduleVersion: '0.0.0' }, [])
  const activated = await activateMainRuntimeContributions(catalog, {
    userDataDir, appRoot: '/synthetic-app', environment: Object.freeze({ NODE_ENV: 'test' }),
    agentThreads: {
      list: async () => [], read: async () => { throw new Error('unused') },
      subscribeMessages: async function* () {}, hasActiveTurns: () => false
    },
    capabilityInvokers: invokers,
    modelAccess: { textReasoner: async () => null },
    executionEvents: { publish: async (owner, event) => domainExecutionEventSchema.parse({
      ...event, schemaVersion: 'sciforge.execution-event.v1', eventId: event.eventId ?? 'review-test',
      producer: owner, occurredAt: event.occurredAt ?? '2026-01-01T00:00:00Z', artifacts: event.artifacts ?? []
    }) },
    enablement: { isEnabled: async () => true, subscribe: () => () => undefined }, log: () => undefined
  })
  return { broker, workspace, activated, reader: bound }
}

describe('staging review control through production registry and Broker', () => {
  it('persists one receipt on retry and reads its exact bytes through the public port', async () => {
    const { broker, workspace, activated, reader } = await fixture()
    try {
      const caller = { audience: 'system' as const, callerId: 'review-control:test', workspaceId: workspace }
      const input = { operationId: 'review-operation-001', receipt }
      const first = reviewReceiptCommitResultSchema.parse((await broker.invoke(caller, {
        actionId: 'review.receipt.commit', invocationId: 'review-first', input
      })).output)
      const replay = reviewReceiptCommitResultSchema.parse((await broker.invoke(caller, {
        actionId: 'review.receipt.commit', invocationId: 'review-replay', input
      })).output)
      expect(replay).toEqual(first)
      const read = artifactVersionReadResultV1Schema.parse(await reader.invoke(ARTIFACT_VERSION_READ_CONTRACT, {
        versionId: first.versionId
      }, { workspaceId: workspace }))
      if (!read.ok) throw new Error('Read failed')
      expect(JSON.parse(Buffer.from(read.value.dataBase64, 'base64').toString('utf8'))).toEqual(receipt)
      const events = await reader.invoke(ARTIFACT_VERSION_EVENT_LIST_CONTRACT, { afterSequence: 0, limit: 100 }, { workspaceId: workspace })
      expect(events.ok).toBe(true)
      if (!events.ok) throw new Error('Events failed')
      expect(events.value.events.filter((event) => event.type === 'version-committed')).toHaveLength(1)
      const audits = broker.listAuditRecords().filter((record) => record.actionId === 'review.receipt.commit')
      expect(audits).toHaveLength(2)
      expect(audits.every((record) => record.status === 'success')).toBe(true)
      expect(JSON.stringify(audits)).not.toContain(receipt.actorHash)
      for (const audit of audits) {
        expect(audit).not.toHaveProperty('input')
        expect(audit).not.toHaveProperty('output')
      }
    } finally { await activated.dispose() }
  })
  it('rejects callers outside the staging system audience', async () => {
    const { broker, workspace, activated } = await fixture()
    try {
      await expect(broker.invoke({ audience: 'agent', callerId: 'agent:test', workspaceId: workspace }, {
        actionId: 'review.receipt.commit', invocationId: 'review-agent',
        input: { operationId: 'review-operation-001', receipt }
      })).rejects.toThrow()
    } finally { await activated.dispose() }
  })
  it('rejects missing workspace before persistence', async () => {
    const { broker, workspace, activated, reader } = await fixture()
    try {
      await expect(broker.invoke({ audience: 'system', callerId: 'review-control:test' }, {
        actionId: 'review.receipt.commit', invocationId: 'review-no-workspace',
        input: { operationId: 'review-operation-001', receipt }
      })).rejects.toThrow()
      const events = await reader.invoke(ARTIFACT_VERSION_EVENT_LIST_CONTRACT, { afterSequence: 0, limit: 100 }, { workspaceId: workspace })
      if (!events.ok) throw new Error('Events failed')
      expect(events.value.events).toHaveLength(0)
    } finally { await activated.dispose() }
  })
  it('rejects an aborted Broker call without committing a version', async () => {
    const { broker, workspace, activated, reader } = await fixture()
    try {
      await expect(broker.invoke({ audience: 'system', callerId: 'review-control:test', workspaceId: workspace }, {
        actionId: 'review.receipt.commit', invocationId: 'review-aborted',
        input: { operationId: 'review-operation-001', receipt }
      }, { signal: AbortSignal.abort() })).rejects.toThrow()
      const events = await reader.invoke(ARTIFACT_VERSION_EVENT_LIST_CONTRACT, { afterSequence: 0, limit: 100 }, { workspaceId: workspace })
      if (!events.ok) throw new Error('Events failed')
      expect(events.value.events).toHaveLength(0)
    } finally { await activated.dispose() }
  })
  it('rejects a revoked Principal before persistence', async () => {
    let reads = 0
    const principal: PrincipalSnapshot = {
      authority: 'sciforge.identity-access', subject: 'synthetic-reviewer',
      assurance: 'local-selection', deviceId: 'synthetic-device', identityVersion: 1
    }
    const { broker, workspace, activated, reader } = await fixture({
      resolveCurrentPrincipal: () => ++reads === 1 ? principal : null
    })
    try {
      await expect(broker.invoke({ audience: 'system', callerId: 'review-control:test', workspaceId: workspace }, {
        actionId: 'review.receipt.commit', invocationId: 'review-revoked',
        input: { operationId: 'review-operation-001', receipt }
      })).rejects.toMatchObject({ code: 'principal_changed' })
      const audits = broker.listAuditRecords().filter((record) => record.actionId === 'review.receipt.commit')
      expect(audits.every((record) => record.status !== 'success')).toBe(true)
      const events = await reader.invoke(ARTIFACT_VERSION_EVENT_LIST_CONTRACT, { afterSequence: 0, limit: 100 }, { workspaceId: workspace })
      if (!events.ok) throw new Error('Events failed')
      expect(events.value.events).toHaveLength(0)
    } finally { await activated.dispose() }
  })
  it('fails closed when Artifact Versions has stopped', async () => {
    const { broker, workspace, activated } = await fixture()
    await activated.dispose()
    await expect(broker.invoke({ audience: 'system', callerId: 'review-control:test', workspaceId: workspace }, {
      actionId: 'review.receipt.commit', invocationId: 'review-storage-stopped',
      input: { operationId: 'review-operation-001', receipt }
    })).rejects.toThrow('Artifact Versions')
    const audits = broker.listAuditRecords().filter((record) => record.actionId === 'review.receipt.commit')
    expect(audits).toHaveLength(1)
    expect(audits[0]?.status).toBe('failed')
    expect(audits[0]).not.toHaveProperty('output')
  })
  it('rejects private payload fields without putting their values in Broker audit records', async () => {
    const { broker, workspace, activated, reader } = await fixture()
    try {
      const caller = { audience: 'system' as const, callerId: 'review-control:test', workspaceId: workspace }
      for (const key of ['commentBody', 'participantId', 'rawText', 'accountId', 'apiKey']) {
        await expect(broker.invoke(caller, {
          actionId: 'review.receipt.commit', invocationId: `review-private-${key}`,
          input: { operationId: 'review-operation-001', receipt: { ...receipt, [key]: `private-sentinel-${key}` } }
        })).rejects.toThrow()
      }
      const audits = broker.listAuditRecords().filter((record) => record.actionId === 'review.receipt.commit')
      expect(audits).toHaveLength(5)
      expect(JSON.stringify(audits)).not.toContain('private-sentinel-')
      for (const audit of audits) {
        expect(audit).not.toHaveProperty('input')
        expect(audit).not.toHaveProperty('output')
      }
      const events = await reader.invoke(ARTIFACT_VERSION_EVENT_LIST_CONTRACT, { afterSequence: 0, limit: 100 }, { workspaceId: workspace })
      if (!events.ok) throw new Error('Events failed')
      expect(events.value.events).toHaveLength(0)
    } finally { await activated.dispose() }
  })
  it('rejects conflicting replay while preserving the original persisted receipt', async () => {
    const { broker, workspace, activated, reader } = await fixture()
    try {
      const caller = { audience: 'system' as const, callerId: 'review-control:test', workspaceId: workspace }
      const committed = reviewReceiptCommitResultSchema.parse((await broker.invoke(caller, {
        actionId: 'review.receipt.commit', invocationId: 'review-original',
        input: { operationId: 'review-operation-001', receipt }
      })).output)
      await expect(broker.invoke(caller, {
        actionId: 'review.receipt.commit', invocationId: 'review-conflict',
        input: { operationId: 'review-operation-001', receipt: { ...receipt, verdict: 'rejected' } }
      })).rejects.toThrow()
      const read = await reader.invoke(ARTIFACT_VERSION_READ_CONTRACT, { versionId: committed.versionId }, { workspaceId: workspace })
      if (!read.ok) throw new Error('Read failed')
      expect(JSON.parse(Buffer.from(read.value.dataBase64, 'base64').toString('utf8'))).toEqual(receipt)
      const events = await reader.invoke(ARTIFACT_VERSION_EVENT_LIST_CONTRACT, { afterSequence: 0, limit: 100 }, { workspaceId: workspace })
      if (!events.ok) throw new Error('Events failed')
      expect(events.value.events.filter((event) => event.type === 'version-committed')).toHaveLength(1)
    } finally { await activated.dispose() }
  })
  it('does not expose a receipt version through a different workspace', async () => {
    const { broker, workspace, activated, reader } = await fixture()
    try {
      const committed = reviewReceiptCommitResultSchema.parse((await broker.invoke({
        audience: 'system', callerId: 'review-control:test', workspaceId: workspace
      }, {
        actionId: 'review.receipt.commit', invocationId: 'review-original',
        input: { operationId: 'review-operation-001', receipt }
      })).output)
      const otherWorkspace = join(workspace, 'other')
      await mkdir(otherWorkspace)
      const read = await reader.invoke(ARTIFACT_VERSION_READ_CONTRACT, { versionId: committed.versionId }, { workspaceId: otherWorkspace })
      expect(read.ok).toBe(false)
    } finally { await activated.dispose() }
  })
})
