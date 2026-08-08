import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  domainArtifactEventScope,
  isDomainArtifactConsumer,
  isDomainMainActionGuard,
  isDomainMainRuntimeLifecycleContribution,
  type DomainMainTurnLifecycleEvent,
  type DomainMainModelAccessHost,
  type DomainRendererCapabilityChange,
  type DomainRendererCapabilityInvoker,
  type DomainVisibleContextInspection,
  type DomainWorkbenchRightPanelRenderContext
} from './host.js'

describe('domain host contracts', () => {
  it('validates runtime lifecycle and artifact consumer contributions structurally', () => {
    assert.equal(isDomainMainRuntimeLifecycleContribution({
      activate: () => undefined
    }), true)
    assert.equal(isDomainMainRuntimeLifecycleContribution({
      activate: 'not-a-function'
    }), false)
    assert.equal(isDomainArtifactConsumer({
      consume: () => undefined
    }), true)
    assert.equal(isDomainArtifactConsumer(null), false)
  })

  it('derives one stable synthetic DAG scope for threadless executions', () => {
    assert.deepEqual(domainArtifactEventScope({
      contractVersion: 1,
      kind: 'execution-completed',
      producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-42',
      runId: 'run-42',
      targetWatermark: 'event-42',
      occurredAt: '2026-08-05T00:00:00.000Z',
      artifacts: []
    }), {
      runtimeId: 'domain:sciforge.create-loop',
      threadId: 'execution:execution-42'
    })
  })

  it('validates action guard contributions structurally', () => {
    assert.equal(isDomainMainActionGuard({
      actions: ['write.export'],
      evaluate: () => ({ allowed: true })
    }), true)
    assert.equal(isDomainMainActionGuard({
      actions: [],
      evaluate: () => ({ allowed: true })
    }), false)
    assert.equal(isDomainMainActionGuard({
      actions: ['write.export', 'write.export'],
      evaluate: () => ({ allowed: true })
    }), false)
    assert.equal(isDomainMainActionGuard({
      actions: ['write.export'],
      evaluate: 'not-a-function'
    }), false)
  })

  it('models right-panel session identity separately from optional activation data', () => {
    const context: DomainWorkbenchRightPanelRenderContext = {
      active: true,
      className: 'h-full',
      onCollapse: () => undefined,
      session: {
        id: 'session-owner',
        runtimeId: 'agent-runtime',
        workspaceRoot: '/workspace/owner'
      },
      activation: {
        contributionId: 'example.panel',
        revision: 3,
        payload: { selection: 'node-3' }
      }
    }

    assert.equal(context.session.workspaceRoot, '/workspace/owner')
    assert.deepEqual(context.activation?.payload, { selection: 'node-3' })
  })

  it('models text reasoning access without exposing host settings', async () => {
    const modelAccess: DomainMainModelAccessHost = {
      textReasoner: async () => ({
        baseUrl: 'http://127.0.0.1:3892/v1',
        apiKey: 'runtime-secret',
        model: 'sciforge-router'
      })
    }

    assert.deepEqual(await modelAccess.textReasoner(), {
      baseUrl: 'http://127.0.0.1:3892/v1',
      apiKey: 'runtime-secret',
      model: 'sciforge-router'
    })
  })

  it('models process-neutral turn lifecycle events', () => {
    const before: DomainMainTurnLifecycleEvent = {
      kind: 'before-turn',
      state: 'starting',
      runtimeId: 'runtime-1',
      threadId: 'thread-1',
      workspaceRoot: '/workspace',
      occurredAt: '2026-07-28T00:00:00.000Z'
    }
    const after: DomainMainTurnLifecycleEvent = {
      kind: 'after-turn',
      state: 'completed',
      runtimeId: 'runtime-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceRoot: '/workspace',
      occurredAt: '2026-07-28T00:00:01.000Z'
    }

    assert.equal(before.kind, 'before-turn')
    assert.equal(after.turnId, 'turn-1')
  })

  it('subscribes to canonical capability changes by resource reference', async () => {
    let listener: ((change: DomainRendererCapabilityChange) => void) | undefined
    const invoker: DomainRendererCapabilityInvoker = {
      observe: async () => {
        throw new Error('not used')
      },
      invoke: async () => {
        throw new Error('not used')
      },
      subscribe: async (resourceRef, next) => {
        assert.equal(resourceRef, 'resource-ref-1')
        listener = next
        return () => {
          listener = undefined
        }
      }
    }
    const dispose = await invoker.subscribe?.('resource-ref-1', () => undefined)

    assert.equal(typeof dispose, 'function')
    listener?.({
      resourceRef: 'resource-ref-1',
      resourceKind: 'fixture.state',
      actionId: 'fixture.state.refresh',
      beforeRevision: 'revision-1',
      afterRevision: 'revision-2',
      changedAt: '2026-07-28T00:00:00.000Z'
    })
    dispose?.()
    assert.equal(listener, undefined)
  })

  it('keeps redacted visual targets opaque to package overlays', () => {
    const denied: DomainVisibleContextInspection = {
      selectable: false,
      reason: 'redacted'
    }
    const visible: DomainVisibleContextInspection = {
      selectable: true,
      targetRef: 'host-signed-target-ref',
      componentId: 'fixture.viewer',
      target: {
        id: 'fixture.target',
        kind: 'region'
      },
      bounds: {
        x: 10,
        y: 20,
        width: 300,
        height: 200
      }
    }

    assert.equal(denied.selectable, false)
    assert.equal(visible.selectable, true)
    if (visible.selectable) {
      assert.equal(visible.targetRef, 'host-signed-target-ref')
      assert.equal(visible.bounds.width, 300)
    }
  })
})
