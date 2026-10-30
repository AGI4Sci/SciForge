import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { workerDeliveryConfirmationDigest, projectCompletionTargetDigest } from '@sciforge/collaboration-contracts'
import type { DomainMainHumanAction, DomainMainHumanActionsHost } from '@sciforge/domain-sdk/host'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { CapabilityBroker } from './broker'
import { CapabilityRegistry, defineCapability } from './registry'

const workerTarget = {
  projectId: 'prj_Project000001', taskId: 'tsk_Task00000001', executionId: 'exe_Execution001',
  contractRevision: 1, resultRevision: 2, bundleDigest: 'a'.repeat(64), decision: 'approved' as const
}
const completionTarget = {
  projectId: workerTarget.projectId, expectedProjectRevision: 3,
  expectedCoordinatorAuthorityEpoch: 1, expectedExecutionAuthorityEpoch: 1,
  projectPlanId: 'pln_Plan00000001', confirmedPlanRevision: 2,
  projectResultIds: ['res_Result000001'], summary: 'Validated result — 实验.'
}
const principal: PrincipalSnapshot = {
  authority: 'sciforge-cloud', subject: 'usr_User00000001', deviceId: 'dev_Device000001',
  assurance: 'cloud-authenticated', identityVersion: 1
}
function harness(options: { native?: boolean; audience?: 'ui' | 'agent' | 'system'; approval?: 'none' | 'confirmation' } = {}) {
  let currentPrincipal = principal
  let currentSender: number | undefined = options.native === false ? undefined : 42
  let handle: (broker: CapabilityBroker) => void | Promise<void> = () => undefined
  const capability = defineCapability({
    id: 'test.confirm-target', version: '1', title: 'Confirm target', description: 'Confirms one exact target.',
    audiences: options.approval === 'none' ? ['ui'] : ['ui', 'agent', 'system'], scope: 'global', effect: 'external-write',
    approval: options.approval ?? 'confirmation', concurrency: { revision: 'none', idempotency: 'required' },
    inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.object({ ok: z.literal(true) }),
    handler: async () => { await handle(broker); return { output: { ok: true as const }, changed: false } }
  })
  const broker = new CapabilityBroker(new CapabilityRegistry([capability]), {
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    resolveCurrentPrincipal: () => currentPrincipal,
    resolveNativeUiWebContentsId: () => currentSender
  })
  let invocation = 0
  return {
    broker,
    run: (handler: typeof handle, input = { target: workerTarget }) => {
      handle = handler
      const invocationId = `confirm-${++invocation}`
      return broker.invoke({ audience: options.audience ?? 'ui', callerId: 'window:42',
        approvals: [{ actionId: capability.descriptor.id, invocationId, mode: 'confirmation' }] },
      { actionId: capability.descriptor.id, invocationId, input })
    },
    runSession: (handler: typeof handle, text: string, assertSessionCurrent = () => undefined) => {
      handle = handler
      return broker.invokeHumanSessionConfirmation({ audience: options.audience ?? 'ui', callerId: 'window:42' },
        { actionId: capability.descriptor.id, input: { target: workerTarget } },
        { runtimeId: 'codex', threadId: 'private-thread', messageId: 'native-message-1', text, assertSessionCurrent })
    },
    changePrincipal: () => { currentPrincipal = { ...principal, identityVersion: 2 } },
    closeWindow: () => { currentSender = undefined }
  }
}

describe('Broker exact human confirmation', () => {
  it('captures one immutable action and binds the same canonical digest as the contracts', async () => {
    const h = harness()
    await h.run((broker) => {
      const action = broker.captureHumanAction({ target: workerTarget })
      expect(action).toMatchObject({ confirmedInputDigest: workerDeliveryConfirmationDigest(workerTarget),
        interaction: 'explicit_click', sourceMessageDigest: null, occurredAt: '2026-10-16T00:00:00.000Z' })
      expect(Object.isFrozen(action)).toBe(true)
      expect(broker.captureHumanAction({ target: workerTarget })).toBe(action)
      const lease = broker.validateHumanAction({ target: workerTarget, action })
      expect(lease.principal).toEqual(principal)
      lease.assertCurrent()
    })
  })

  it('matches the canonical Project completion digest, preserving result order', async () => {
    const h = harness()
    await h.run((broker) => {
      expect(broker.captureHumanAction({ target: completionTarget }).confirmedInputDigest)
        .toBe(projectCompletionTargetDigest(completionTarget))
    }, { target: completionTarget } as never)
  })

  it.each([
    ['Agent', { audience: 'agent' as const }],
    ['system', { audience: 'system' as const }],
    ['browser or bare UI caller', { native: false }],
    ['unconfirmed capability', { approval: 'none' as const }]
  ])('denies %s even with matching caller-supplied grant IDs', async (_label, options) => {
    const h = harness(options)
    await expect(h.run((broker) => { broker.captureHumanAction({ target: workerTarget }) }))
      .rejects.toMatchObject({ code: 'human_confirmation_required' })
  })

  it('requires exact wrapped target, not a target buried in other approved input', async () => {
    const h = harness()
    await expect(h.run((broker) => { broker.captureHumanAction({ target: workerTarget }) },
      { target: workerTarget, other: 'unconfirmed sibling' } as never))
      .rejects.toMatchObject({ code: 'human_confirmation_required' })
  })

  it('rejects changed targets, fabricated action fields and previous invocation actions', async () => {
    const h = harness()
    let original!: DomainMainHumanAction
    await h.run((broker) => {
      original = broker.captureHumanAction({ target: workerTarget })
      expect(() => broker.captureHumanAction({ target: { ...workerTarget, resultRevision: 3 } })).toThrow()
      for (const changed of [
        { actionId: 'forged-action' }, { confirmedInputDigest: 'f'.repeat(64) },
        { occurredAt: '2026-10-15T00:00:00.000Z' }, { sourceMessageDigest: 'f'.repeat(64) },
        { interaction: 'session_message' as const }
      ]) {
        expect(() => broker.validateHumanAction({ target: workerTarget, action: { ...original, ...changed } })).toThrow()
      }
    })
    await expect(h.run((broker) => { broker.validateHumanAction({ target: workerTarget, action: original }) }))
      .rejects.toMatchObject({ code: 'human_confirmation_required' })
  })

  it('expires the lease when the invocation ends', async () => {
    const h = harness()
    let lease!: ReturnType<DomainMainHumanActionsHost['validate']>
    await h.run((broker) => {
      lease = broker.validateHumanAction({ target: workerTarget, action: broker.captureHumanAction({ target: workerTarget }) })
    })
    expect(() => lease.assertCurrent()).toThrow()
    expect(() => h.broker.captureHumanAction({ target: workerTarget })).toThrow()
  })

  it.each(['principal', 'window'] as const)('invalidates an in-flight lease when %s changes', async (change) => {
    const h = harness()
    await h.run(async (broker) => {
      const lease = broker.validateHumanAction({ target: workerTarget, action: broker.captureHumanAction({ target: workerTarget }) })
      await Promise.resolve()
      if (change === 'principal') h.changePrincipal()
      else h.closeWindow()
      expect(() => lease.assertCurrent()).toThrow()
    }).catch((error: { code: string }) => { expect(error.code).toBe('outcome_unknown') })
  })
  it('uses the same capability for a genuine Session decision and exposes only a message digest', async () => {
    const h = harness()
    const text = '确认提交当前候选'
    let checks = 0
    let action!: DomainMainHumanAction
    await h.runSession((broker) => {
      action = broker.captureHumanAction({ target: workerTarget })
      broker.validateHumanAction({ target: workerTarget, action }).assertCurrent()
      expect(action).toMatchObject({ interaction: 'session_message',
        sourceMessageDigest: createHash('sha256').update(text).digest('hex') })
      expect(JSON.stringify(action)).not.toContain(text)
      expect(JSON.stringify(action)).not.toContain('private-thread')
    }, text, () => { checks++ })
    expect(checks).toBeGreaterThanOrEqual(5)
    expect(JSON.stringify(h.broker.listAuditRecords())).not.toContain(text)
    await expect(h.runSession(() => undefined, 'a changed message')).rejects.toMatchObject({ code: 'idempotency_conflict' })
  })

  it.each([
    { native: false }, { audience: 'agent' as const }, { audience: 'system' as const },
    { approval: 'none' as const }
  ])('rejects Session decisions without real native human authority: %j', async (options) => {
    const h = harness(options)
    await expect(h.runSession(() => undefined, 'Confirm')).rejects.toMatchObject({ code: 'human_confirmation_required' })
  })

  it('rechecks the Session lease during signing and refuses a stale presented decision', async () => {
    const h = harness()
    let valid = true
    await h.runSession((broker) => {
      const action = broker.captureHumanAction({ target: workerTarget })
      const lease = broker.validateHumanAction({ target: workerTarget, action })
      valid = false
      expect(() => lease.assertCurrent()).toThrow('Session changed')
    }, 'Confirm', () => { if (!valid) throw new Error('Session changed') })
      .catch((error: Error) => expect(error.message).toBe('Session changed'))
  })

})
