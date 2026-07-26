import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDomainAgentArtifactConsumer,
  isDomainMainActionGuard,
  isDomainMainRuntimeLifecycleContribution,
  type DomainMainModelAccessHost,
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
    assert.equal(isDomainAgentArtifactConsumer({
      consume: () => undefined
    }), true)
    assert.equal(isDomainAgentArtifactConsumer(null), false)
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
})
