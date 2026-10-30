import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagAuditQueryOutputSchema,
  evidenceDagClosurePolicyV1Schema,
  evidenceDagSealClosureOutputSchema,
  evidenceDagSidechainAppendOutputSchema,
  evidenceDagUpdateOutputSchema
} from '@sciforge/domain-evidence-dag/contract'
import { createDomainMainEntry as createEvidenceDagMainEntry } from '@sciforge/domain-evidence-dag/main'
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

const RUNTIME_ID = 'codex'
const THREAD_ID = 'thread-audit-broker'
const ENGINE_THREAD_ID = 'codex:thread-audit-broker'
const SIDECHAIN_RECORD_ID = 'record-audit-broker-1'

describe('installed Evidence DAG domain', () => {
  it('drives update, seal, sidechain append, and audit query through the production registry and broker', async () => {
    const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'sciforge-evidence-audit-composition-')))
    temporaryDirectories.push(userDataDir)
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    const domainHost = {
      getUserDataDir: () => userDataDir,
      defineCapability: (options: unknown) => defineCapability(options as never),
      textSanitizer: { sanitizeText: (value: string) => value }
    }
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([createEvidenceDagMainEntry(domainHost)])
    const broker = new CapabilityBroker(
      createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
    )
    const activated = await activateMainRuntimeContributions(catalog, {
      userDataDir,
      appRoot: '/app',
      environment: Object.freeze({
        NODE_ENV: 'test',
        // The Evidence sidecar is never awaited on this path (the seal below
        // stays incomplete by policy), and no Python service may spawn here.
        SCIFORGE_EVIDENCE_DAG_AUTO_START: '0'
      }),
      agentThreads: {
        list: async () => [],
        read: async ({ runtimeId, threadId }) => ({
          id: threadId,
          runtimeId,
          workspaceRoot,
          watermark: '1',
          turns: [],
          artifacts: []
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
          eventId: event.eventId ?? 'execution-event-evidence-audit-test',
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
        callerId: 'ui:evidence-audit-test',
        workspaceId: workspaceRoot
      }
      const systemCaller = {
        audience: 'system' as const,
        callerId: 'system:evidence-audit-test',
        workspaceId: workspaceRoot
      }

      // 1. Queue one durable Evidence update for the synthetic completed
      //    thread. The thread carries no artifacts, so no Artifact Version
      //    port is needed and the delta chain is the only write authority.
      const updateResult = await broker.invoke(uiCaller, {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.update,
        invocationId: 'evidence-audit-update-1',
        input: { runtimeId: RUNTIME_ID, threadId: THREAD_ID }
      })
      const updateOutput = evidenceDagUpdateOutputSchema.parse(updateResult.output)
      const headDigest = updateOutput.status.authoritativeHead?.headDigest
      expect(headDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)

      // 2. Seal one closure at that exact head. The unreachable target claim
      //    keeps the closure incomplete on purpose: an incomplete closure
      //    never materializes a committed Snapshot and therefore never needs
      //    the Evidence sidecar in this test.
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
        invocationId: 'evidence-audit-seal-1',
        input: {
          runtimeId: RUNTIME_ID,
          threadId: THREAD_ID,
          idempotencyKey: 'evidence-audit-seal-key-1',
          policy
        }
      })
      const sealOutput = evidenceDagSealClosureOutputSchema.parse(sealResult.output)
      expect(sealOutput.status).toBe('incomplete')
      expect(sealOutput.closureDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
      expect(sealOutput.gapCodes).toEqual(['missing_delta'])

      // 3. Append one audit sidechain record bound to the sealed closure.
      const appendResult = await broker.invoke(systemCaller, {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.appendSidechain,
        invocationId: 'evidence-audit-sidechain-1',
        input: {
          runtimeId: RUNTIME_ID,
          threadId: THREAD_ID,
          recordId: SIDECHAIN_RECORD_ID,
          recordType: 'audit',
          closureDigest: sealOutput.closureDigest,
          idempotencyKey: 'evidence-audit-record-key-1',
          payload: { summary: 'Broker-driven audit record.' },
          producerIdentity: 'producer:integration-test'
        }
      })
      const appendOutput = evidenceDagSidechainAppendOutputSchema.parse(appendResult.output)
      expect(appendOutput.record.recordId).toBe(SIDECHAIN_RECORD_ID)

      // 4. Read the audit projection back through the same broker. The delta
      //    store file is the only durable Evidence artifact on this path; its
      //    bytes must not change across the pure-read audit query.
      const deltaStorePath = join(userDataDir, 'evidence-dag', 'deltas.json')
      const bytesBefore = await readFile(deltaStorePath)

      const byClosure = evidenceDagAuditQueryOutputSchema.parse((await broker.invoke(uiCaller, {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.auditQuery,
        input: { subject: { closureDigest: sealOutput.closureDigest } }
      })).output)
      expect(byClosure.source).toBe('evidence-dag')
      expect(byClosure.freshness).toBe('fresh')
      expect(byClosure.completeness).toEqual({
        complete: false,
        gapCodes: ['source_unavailable:project']
      })
      expect(byClosure.records.map((record) => record.recordId)).toEqual([SIDECHAIN_RECORD_ID])
      expect(byClosure.records[0]).toEqual(expect.objectContaining({
        recordType: 'audit',
        closureDigest: sealOutput.closureDigest,
        producerIdentity: 'producer:integration-test',
        payload: { summary: 'Broker-driven audit record.' }
      }))

      const byThread = evidenceDagAuditQueryOutputSchema.parse((await broker.invoke(uiCaller, {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.auditQuery,
        input: { subject: { threadId: ENGINE_THREAD_ID } }
      })).output)
      expect(byThread.source).toBe('evidence-dag')
      expect(byThread.freshness).toBe('fresh')
      expect(byThread.completeness).toEqual({ complete: true, gapCodes: [] })
      expect(byThread.records.map((record) => record.recordId)).toEqual([SIDECHAIN_RECORD_ID])

      const bytesAfter = await readFile(deltaStorePath)
      expect(bytesAfter.equals(bytesBefore)).toBe(true)

      const auditRecords = broker.listAuditRecords()
      for (const actionId of [
        EVIDENCE_DAG_CAPABILITY_IDS.update,
        EVIDENCE_DAG_CAPABILITY_IDS.sealClosure,
        EVIDENCE_DAG_CAPABILITY_IDS.appendSidechain,
        EVIDENCE_DAG_CAPABILITY_IDS.auditQuery
      ]) {
        expect(auditRecords.some((record) => (
          record.actionId === actionId && record.status === 'success'
        ))).toBe(true)
      }
      expect(auditRecords.filter((record) => (
        record.status === 'failed' &&
        (Object.values(EVIDENCE_DAG_CAPABILITY_IDS) as string[]).includes(record.actionId)
      ))).toEqual([])
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
