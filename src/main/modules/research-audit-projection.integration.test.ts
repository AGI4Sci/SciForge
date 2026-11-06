import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagClosurePolicyV1Schema,
  evidenceDagSealClosureOutputSchema,
  evidenceDagSidechainAppendOutputSchema,
  evidenceDagUpdateOutputSchema
} from '@sciforge/domain-evidence-dag/contract'
import { createDomainMainEntry as createEvidenceDagMainEntry } from '@sciforge/domain-evidence-dag/main'
import {
  RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS,
  researchAuditSessionChangeListChangesOutputSchema
} from '@sciforge/domain-sdk/research-audit'
import { changeInspectorListChangesOutputSchema } from '../../../plugins/change-inspector/src/contract'
import { EXPECTED_HOST_GRANTS } from '../../../plugins/change-inspector/src/dsh-adapter/tools'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { DevelopmentExternalPluginService } from '../extensions/development-external-plugins'
import { AGENT_THREADS_READ_PORT, createAgentThreadsHostServiceResolver } from '../extensions/agent-threads-host-service'
import { createReadGrantedHostServicePorts, mergeHostServiceResolutions } from '../extensions/host-service-resolution'
import { createWorkspaceAuthority } from '../extensions/workspace-authority'
import type { AgentRuntimeThreadSnapshot } from '../../shared/agent-runtime-contract'
import { capabilityJsonValueSchema, capabilityResourceHandleSchema } from '../../shared/capability-broker'
import { createDomainMainEntry as createProjectDagMainEntry } from '@sciforge/domain-project-dag/main'
import { domainExecutionEventSchema } from '@sciforge/domain-sdk/reproducibility'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { CapabilityBroker } from '../capabilities/broker'
import { defineCapability } from '../capabilities/registry'
import {
  createApplicationCapabilityRegistry
} from './application-composition'
import { DomainModuleCatalog } from './catalog'
import {
  activateMainRuntimeContributions,
  createMainSystemCapabilityInvokerFactory
} from './runtime-contributions'
import {
  createBrokerResearchAuditInvoker,
  ResearchAuditProjectionService,
  researchAuditProjectionOutputSchema,
  RESEARCH_AUDIT_PROJECTION_SOURCE_IDS
} from '../services/research-audit-projection'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  ))
})

const RUNTIME_ID = 'codex'
const THREAD_ID = 'thread-projection-broker'
const ENGINE_THREAD_ID = 'codex:thread-projection-broker'
const SIDECHAIN_RECORD_ID = 'record-projection-broker-1'

const UNIFIED_DIFF = [
  'diff --git a/note.txt b/note.txt',
  '--- a/note.txt',
  '+++ b/note.txt',
  '@@ -0,0 +1 @@',
  '+hello from the integration test'
].join('\n')

describe('installed DAG domains and independent Change Inspector process plugin', () => {
  it('serves the unified research-audit.query projection through the production registry and broker with zero write-capability invocations', async () => {
    const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'sciforge-audit-projection-composition-')))
    temporaryDirectories.push(userDataDir)
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    const domainHost = {
      getUserDataDir: () => userDataDir,
      defineCapability: (options: unknown) => defineCapability(options as never),
      textSanitizer: { sanitizeText: (value: string) => value }
    }
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      createEvidenceDagMainEntry(domainHost),
      createProjectDagMainEntry(domainHost)
    ])
    const registry = createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
    const broker = new CapabilityBroker(registry)
    const threads = [{
      id: THREAD_ID,
      runtimeId: RUNTIME_ID,
      workspaceRoot
    }]
    const packageName = '@sciforge/plugin-change-inspector'
    const { version: packageVersion } = JSON.parse(await readFile(new URL('../../../plugins/change-inspector/package.json', import.meta.url), 'utf8')) as { version: string }
    const contracts = new Map<string, PluginAdapterContract>([[packageName, {
      hostApiRange: '^1.0.0', permissions: [], approved: true,
      dshAuthorization: {
        packageName, packageVersion, dshRuntimeVersion: '0.2.0-rc.2',
        tools: EXPECTED_HOST_GRANTS, ports: [AGENT_THREADS_READ_PORT]
      }
    }]])
    const snapshotReads: { runtimeId: string; threadId: string }[] = []
    const authorizeWorkspace = createWorkspaceAuthority({ readTrustedRoots: () => [workspaceRoot] })
    const hostServices = mergeHostServiceResolutions(createAgentThreadsHostServiceResolver({
      authorizeWorkspace,
      readGrantedPorts: createReadGrantedHostServicePorts(() => contracts),
      hostServiceClientModule: fileURLToPath(new URL('../../../packages/plugin-sdk/src/host-service-client.mjs', import.meta.url)),
      readSnapshot: async ({ runtimeId, threadId }): Promise<AgentRuntimeThreadSnapshot> => {
        snapshotReads.push({ runtimeId, threadId })
        return {
          id: threadId, runtimeId: RUNTIME_ID, title: 'Controlled current Host session', workspace: workspaceRoot,
          latestSeq: 1, updatedAt: '2026-10-26T00:00:00.000Z',
          turns: [{ id: 'turn-projection', threadId, status: 'completed', items: [{
            kind: 'tool', toolKind: 'file_change', id: 'file-change-projection-1',
            status: 'success', detail: JSON.stringify({ changes: [{ path: 'note.txt', kind: 'update', diff: UNIFIED_DIFF }] }),
            createdAt: '2026-10-26T00:00:00.000Z'
          }] }]
        }
      }
    }))
    const plugins = new DevelopmentExternalPluginService({
      root: resolve('plugins'), userDataPath: userDataDir,
      hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2',
      adapterContracts: contracts, authorizeWorkspace, ...hostServices
    })
    const activated = await activateMainRuntimeContributions(catalog, {
      userDataDir,
      appRoot: '/app',
      environment: Object.freeze({
        NODE_ENV: 'test',
        // Neither sidecar may spawn here: the seal stays incomplete by
        // policy and the projection queries degrade honestly by name.
        SCIFORGE_EVIDENCE_DAG_AUTO_START: '0',
        SCIFORGE_PROJECT_DAG_AUTO_START: '0'
      }),
      agentThreads: {
        list: async () => threads,
        read: async ({ runtimeId, threadId }) => ({
          id: threadId,
          runtimeId,
          workspaceRoot,
          watermark: '1',
          turns: [],
          artifacts: [{
            kind: 'tool',
            toolKind: 'file_change',
            id: 'file-change-projection-1',
            status: 'success',
            filePath: 'note.txt',
            detail: UNIFIED_DIFF,
            createdAt: '2026-10-26T00:00:00.000Z'
          }]
        }),
        subscribeMessages: async function* () {},
        hasActiveTurns: () => false
      },
      capabilityInvokers: createMainSystemCapabilityInvokerFactory(broker),
      modelAccess: { textReasoner: async () => null },
      executionEvents: {
        publish: async (owner, event) => domainExecutionEventSchema.parse({
          ...event,
          schemaVersion: 'sciforge.execution-event.v1' as const,
          eventId: event.eventId ?? 'execution-event-audit-projection-test',
          producer: owner,
          occurredAt: event.occurredAt ?? '2099-08-11T08:00:00.000Z',
          artifacts: event.artifacts ?? []
        })
      },
      enablement: {
        isEnabled: async () => true,
        subscribe: () => () => undefined
      },
      log: () => undefined
    })

    try {
      await plugins.initialize()
      await plugins.attachCapabilityRegistry(registry)
      await plugins.setEnabled(packageName, true)
      const listChangesId = RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS.sessionChangeListChanges
      expect(registry.require(listChangesId).descriptor.effect).toBe('read')
      expect(registry.require(listChangesId).descriptor.tags).toContain('dsh-tool')
      const agentCaller = {
        audience: 'agent' as const, callerId: 'agent:audit-projection-test', workspaceId: workspaceRoot
      }
      const ordinarySession = { runtimeId: RUNTIME_ID, threadId: THREAD_ID }
      const opener = registry.list().find(descriptor => descriptor.tags.includes('dsh-session-opener'))
      expect(opener).toBeDefined()
      const resource = capabilityResourceHandleSchema.parse((await broker.invokeOrdinarySession(
        agentCaller, { actionId: opener!.id, input: {} }, ordinarySession
      )).output)
      const agentListChanges = async (input: { sessionId?: string; limit?: number; cursor?: string }) =>
        await broker.invokeOrdinarySession(agentCaller, { actionId: listChangesId, input, resource }, ordinarySession, {
          context: { ...ordinarySession, callId: 'audit-plugin-current-session' }
        })
      // Actual dist/main.js runs in the isolated process; only the generic Host
      // provider serves the controlled current Session. No static test provider
      // is injected into plugin production configuration.
      const permitted = await agentListChanges({ limit: 1 })
      const pluginOutput = changeInspectorListChangesOutputSchema.parse(permitted.output)
      expect(researchAuditSessionChangeListChangesOutputSchema.parse(permitted.output)).toEqual(pluginOutput)
      expect(pluginOutput.changes).toEqual([expect.objectContaining({
        id: 'file-change-projection-1', filePath: 'note.txt', patch: UNIFIED_DIFF, patchTruncated: false
      })])
      expect(snapshotReads).toEqual([{ runtimeId: RUNTIME_ID, threadId: THREAD_ID }])
      await expect(agentListChanges({ sessionId: 'foreign-thread' })).rejects.toThrow(/another session/)
      expect(snapshotReads).toHaveLength(1)
      const uiCaller = {
        audience: 'ui' as const,
        callerId: 'ui:audit-projection-test',
        workspaceId: workspaceRoot
      }
      const systemCaller = {
        audience: 'system' as const,
        callerId: 'system:audit-projection-test',
        workspaceId: workspaceRoot
      }

      // 1. Seed one durable Evidence update + incomplete seal + one audit
      //    sidechain record through the real capability chain.
      const updateResult = await broker.invoke(uiCaller, {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.update,
        invocationId: 'audit-projection-update-1',
        input: { runtimeId: RUNTIME_ID, threadId: THREAD_ID }
      })
      const updateOutput = evidenceDagUpdateOutputSchema.parse(updateResult.output)
      const headDigest = updateOutput.status.authoritativeHead?.headDigest
      expect(headDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)

      const policy = evidenceDagClosurePolicyV1Schema.parse({
        version: 'EvidenceClosurePolicyV1',
        targetClaimIds: ['claim:unreachable'],
        expectedHeadDigest: headDigest,
        barrierWatermark: '1',
        edgeFamilies: [],
        directions: ['inbound'],
        maxDepth: 0,
        termination: 'depth',
        expandEquivalent: false,
        expandRefinement: false,
        cycleHandling: 'allow',
        unknownEdgeHandling: 'ignore',
        requiredRecords: ['claim:unreachable'],
        requiredExternalRefs: []
      })
      const sealResult = await broker.invoke(uiCaller, {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.sealClosure,
        invocationId: 'audit-projection-seal-1',
        input: {
          runtimeId: RUNTIME_ID,
          threadId: THREAD_ID,
          idempotencyKey: 'audit-projection-seal-key-1',
          policy
        }
      })
      const sealOutput = evidenceDagSealClosureOutputSchema.parse(sealResult.output)
      expect(sealOutput.status).toBe('incomplete')
      expect(sealOutput.closureDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)

      const appendResult = await broker.invoke(systemCaller, {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.appendSidechain,
        invocationId: 'audit-projection-sidechain-1',
        input: {
          runtimeId: RUNTIME_ID,
          threadId: THREAD_ID,
          recordId: SIDECHAIN_RECORD_ID,
          recordType: 'audit',
          closureDigest: sealOutput.closureDigest,
          idempotencyKey: 'audit-projection-record-key-1',
          payload: { summary: 'Broker-driven audit record for the projection test.' },
          producerIdentity: 'producer:integration-test'
        }
      })
      expect(evidenceDagSidechainAppendOutputSchema.parse(appendResult.output).record.recordId)
        .toBe(SIDECHAIN_RECORD_ID)

      const service = new ResearchAuditProjectionService({
        invoker: createBrokerResearchAuditInvoker(broker, { workspaceId: workspaceRoot }),
        threads: {
          list: async () => threads.map((thread) => ({
            id: thread.id,
            runtimeId: thread.runtimeId
          }))
        }
      })

      const deltaStorePath = join(userDataDir, 'evidence-dag', 'deltas.json')
      const bytesBeforeQueries = await readFile(deltaStorePath)
      const readsBeforeSystemAudit = snapshotReads.length
      const agentProjection = new ResearchAuditProjectionService({
        invoker: {
          invoke: async (actionId, input) => (actionId === listChangesId
            ? await agentListChanges(input as { sessionId?: string; limit?: number; cursor?: string })
            : await broker.invoke(agentCaller, { actionId, input: capabilityJsonValueSchema.parse(input) })).output
        },
        threads: { list: async () => threads }
      })
      const byPermittedAgent = researchAuditProjectionOutputSchema.parse(await agentProjection.query({
        threadId: ENGINE_THREAD_ID
      }))
      expect(byPermittedAgent.sourceAvailability).toEqual({
        evidence: 'available', sessionChange: 'available', project: 'unavailable', checkpoint: 'unavailable'
      })
      expect(byPermittedAgent.completeness).toEqual({
        complete: false, gapCodes: ['source_unavailable:project', 'source_unavailable:checkpoint']
      })
      expect(byPermittedAgent.freshnessSources).toEqual(['evidence', 'sessionChange'])
      expect(byPermittedAgent.records).toContainEqual(expect.objectContaining({
        recordType: 'evidence-sidechain', recordId: SIDECHAIN_RECORD_ID
      }))
      expect(byPermittedAgent.records).toContainEqual(expect.objectContaining({
        recordType: 'session-change', recordId: 'file-change-projection-1',
        payload: expect.objectContaining({ filePath: 'note.txt', patchTruncated: false })
      }))
      expect(snapshotReads).toHaveLength(readsBeforeSystemAudit + 1)
      const readsAfterAgentProjection = snapshotReads.length
      // The system/UI audit service has no authenticated Agent Session. A
      // matching thread directory is a selector, not authority: it must degrade
      // honestly instead of widening the generic agent-read Host contract.
      const byThread = researchAuditProjectionOutputSchema.parse(await service.query({
        threadId: ENGINE_THREAD_ID
      }))
      expect(byThread.sourceAvailability).toEqual({
        evidence: 'available',
        sessionChange: 'unavailable',
        project: 'unavailable',
        checkpoint: 'unavailable'
      })
      expect(byThread.completeness).toEqual({
        complete: false,
        gapCodes: ['source_unavailable:session-change', 'source_unavailable:project', 'source_unavailable:checkpoint']
      })
      expect(byThread.freshness).toBe('fresh')
      expect(byThread.freshnessSources).toEqual(['evidence'])
      expect(snapshotReads).toHaveLength(readsAfterAgentProjection)
      expect(byThread.records).toEqual([
        expect.objectContaining({
          recordType: 'evidence-sidechain',
          recordId: SIDECHAIN_RECORD_ID,
          producer: 'producer:integration-test',
          digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
        })
      ])

      // 3. Query by closure digest: only Evidence binds to a closure.
      const byClosure = researchAuditProjectionOutputSchema.parse(await service.query({
        closureDigest: sealOutput.closureDigest
      }))
      expect(byClosure.sourceAvailability).toEqual({
        evidence: 'available',
        sessionChange: 'unavailable',
        project: 'unavailable',
        checkpoint: 'unavailable'
      })
      expect(byClosure.completeness).toEqual({
        complete: false,
        gapCodes: [
          'source_unavailable:session-change',
          'source_unavailable:project',
          'source_unavailable:checkpoint'
        ]
      })
      expect(byClosure.records).toEqual([
        expect.objectContaining({
          recordType: 'evidence-sidechain',
          recordId: SIDECHAIN_RECORD_ID
        })
      ])

      // 4. Zero writes: the delta store bytes are unchanged by the queries,
      //    every query-phase invocation resolved to a read effect through
      //    the production registry, and no write capability was invoked.
      const bytesAfterQueries = await readFile(deltaStorePath)
      const auditRecords = broker.listAuditRecords()
      const queryPhaseRecords = auditRecords.filter((record) =>
        record.caller.callerId === 'host:research-audit-projection' ||
        record.caller.callerId === agentCaller.callerId
      )
      expect(queryPhaseRecords.length).toBeGreaterThan(0)
      for (const record of queryPhaseRecords) {
        const effect = broker.registry.require(record.actionId).descriptor.effect
        expect(effect).toBe('read')
      }
      const writeIds = new Set<string>([
        EVIDENCE_DAG_CAPABILITY_IDS.update,
        EVIDENCE_DAG_CAPABILITY_IDS.sealClosure,
        EVIDENCE_DAG_CAPABILITY_IDS.appendSidechain
      ])
      expect(auditRecords.filter((record) => writeIds.has(record.actionId))).toHaveLength(3)
      expect(bytesAfterQueries).toEqual(bytesBeforeQueries)
      expect(bytesAfterQueries.length).toBeGreaterThan(0)
      for (const source of RESEARCH_AUDIT_PROJECTION_SOURCE_IDS) {
        expect(byThread.sourceAvailability[source]).toBeDefined()
      }
    } finally {
      await plugins.dispose()
      await activated.dispose()
      catalog.dispose()
    }
  }, 60_000)
})

function unavailableCoreDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies
}
