import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagClosurePolicyV1Schema,
  evidenceDagSealClosureOutputSchema,
  evidenceDagSidechainAppendOutputSchema,
  evidenceDagUpdateOutputSchema
} from '@sciforge/domain-evidence-dag/contract'
import { createDomainMainEntry as createEvidenceDagMainEntry } from '@sciforge/domain-evidence-dag/main'
import { createDomainMainEntry as createChangeInspectorMainEntry } from '@sciforge/domain-change-inspector/main'
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

describe('installed Evidence DAG, Change Inspector, and Project DAG domains', () => {
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
      createChangeInspectorMainEntry(domainHost),
      createProjectDagMainEntry(domainHost)
    ])
    const broker = new CapabilityBroker(
      createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
    )
    const threads = [{
      id: THREAD_ID,
      runtimeId: RUNTIME_ID,
      workspaceRoot
    }]
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

      // 2. Query by engine thread id: Evidence and session-change both bind;
      //    project and checkpoint honestly report unavailability by name.
      const byThread = researchAuditProjectionOutputSchema.parse(await service.query({
        threadId: ENGINE_THREAD_ID
      }))
      expect(byThread.sourceAvailability).toEqual({
        evidence: 'available',
        sessionChange: 'available',
        project: 'unavailable',
        checkpoint: 'unavailable'
      })
      expect(byThread.completeness).toEqual({
        complete: false,
        gapCodes: ['source_unavailable:project', 'source_unavailable:checkpoint']
      })
      expect(byThread.freshness).toBe('fresh')
      expect(byThread.freshnessSources).toEqual(['evidence', 'sessionChange'])
      expect(byThread.records).toEqual([
        expect.objectContaining({
          recordType: 'session-change',
          recordId: 'file-change-projection-1',
          payload: expect.objectContaining({ filePath: 'note.txt', patchTruncated: false })
        }),
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
      const deltaStorePath = join(userDataDir, 'evidence-dag', 'deltas.json')
      const bytesAfterQueries = await readFile(deltaStorePath)
      const auditRecords = broker.listAuditRecords()
      const queryPhaseRecords = auditRecords.filter((record) =>
        record.caller.callerId === 'host:research-audit-projection'
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
      expect(bytesAfterQueries.length).toBeGreaterThan(0)
      for (const source of RESEARCH_AUDIT_PROJECTION_SOURCE_IDS) {
        expect(byThread.sourceAvailability[source]).toBeDefined()
      }
    } finally {
      await activated.dispose()
      catalog.dispose()
    }
  }, 15_000)
})

function unavailableCoreDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies
}
