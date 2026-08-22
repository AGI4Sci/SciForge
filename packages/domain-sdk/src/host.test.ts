import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  domainArtifactEventScope,
  defineDomainMainInternalServiceDescriptor,
  defineDomainMainSystemCapabilityGrant,
  domainMainRuntimeLifecycleContractSchema,
  domainWorkbenchRightPanelPlacementSchema,
  isDomainArtifactConsumer,
  isDomainMainActionGuard,
  isDomainMainRuntimeMcpServerContribution,
  isDomainMcpTrustedInvocationMetadataContribution,
  isDomainMainRuntimeLifecycleContribution,
  type DomainMainAfterTurnEvent,
  type DomainMainBeforeTurnEvent,
  type DomainMainModelAccessHost,
  type DomainMainTextSanitizerHost,
  type DomainRendererCapabilityChange,
  type DomainRendererCapabilityInvoker,
  type DomainVisibleContextInspection,
  type DomainWorkbenchOpenRightPanelInput,
  type DomainWorkbenchRightPanelRenderContext,
  type DomainWorkbenchRightPanelTarget,
  type DomainWorkspacePreviewTarget
} from './host.js'

describe('domain host contracts', () => {
  it('defines strict non-callable internal service descriptors', () => {
    assert.deepEqual(defineDomainMainInternalServiceDescriptor({
      location: 'main.internal-service-descriptor',
      serviceId: 'opencontent.content-space',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.opencontent-content-space-provider']
    }), {
      location: 'main.internal-service-descriptor',
      serviceId: 'opencontent.content-space',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.opencontent-content-space-provider']
    })
    assert.throws(() => defineDomainMainInternalServiceDescriptor({
      location: 'main.internal-service-descriptor',
      serviceId: 'opencontent.content-space',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: [
        'sciforge.opencontent-content-space-provider',
        'sciforge.opencontent-content-space-provider'
      ]
    }))
  })

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

  it('validates generic managed MCP and trusted metadata contributions', () => {
    assert.equal(isDomainMainRuntimeMcpServerContribution({
      serverId: 'fixture', createConfig: () => null,
      isRuntimeEnabled: () => true
    }), true)
    assert.equal(isDomainMainRuntimeMcpServerContribution({
      serverId: '', createConfig: () => null
    }), false)
    assert.equal(isDomainMcpTrustedInvocationMetadataContribution({
      serverId: 'fixture', tools: ['mutate'], metadataKey: 'fixture/trusted',
      source: 'trusted-invocation'
    }), true)
    assert.equal(isDomainMcpTrustedInvocationMetadataContribution({
      serverId: 'fixture', tools: ['mutate', 'mutate'], metadataKey: 'fixture/trusted',
      source: 'trusted-invocation'
    }), false)
  })

  it('separates provider-owned system grants from lifecycle grant requests', () => {
    assert.deepEqual(defineDomainMainSystemCapabilityGrant({
      id: 'artifact-versions.identities.select',
      eligibility: 'trusted-domain-runtime',
      description: 'Allows a trusted runtime to select immutable identities.'
    }), {
      id: 'artifact-versions.identities.select',
      eligibility: 'trusted-domain-runtime',
      description: 'Allows a trusted runtime to select immutable identities.'
    })
    assert.deepEqual(domainMainRuntimeLifecycleContractSchema.parse({
      requestedSystemCapabilityGrants: ['artifact-versions.identities.select']
    }), {
      requestedSystemCapabilityGrants: ['artifact-versions.identities.select']
    })
    assert.throws(() => domainMainRuntimeLifecycleContractSchema.parse({
      requestedSystemCapabilityGrants: [
        'artifact-versions.identities.select',
        'artifact-versions.identities.select'
      ]
    }))
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

  it('models right-panel viewport visibility separately from focus and mounted identity', () => {
    const context: DomainWorkbenchRightPanelRenderContext = {
      active: true,
      focused: false,
      surfaceId: 'right-panel-surface-2',
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
    const mountedOffscreenContext: DomainWorkbenchRightPanelRenderContext = {
      ...context,
      active: false,
      focused: false,
      surfaceId: 'right-panel-surface-3'
    }

    assert.equal(context.session.workspaceRoot, '/workspace/owner')
    assert.equal(context.active, true)
    assert.equal(context.focused, false)
    assert.equal(context.surfaceId, 'right-panel-surface-2')
    assert.equal(mountedOffscreenContext.active, false)
    assert.equal(mountedOffscreenContext.surfaceId, 'right-panel-surface-3')
    assert.deepEqual(context.activation?.payload, { selection: 'node-3' })
  })

  it('models mutually exclusive focused, new, and exact right-panel targets', () => {
    const defaultTarget: DomainWorkbenchRightPanelTarget = {}
    const rightPanel: DomainWorkbenchOpenRightPanelInput = {
      contributionId: 'example.panel',
      sessionId: 'session-owner',
      placement: 'new'
    }
    const preview: DomainWorkspacePreviewTarget = {
      path: 'results/figure.png',
      sessionId: 'session-owner',
      placement: 'focused'
    }
    const exactPreview: DomainWorkspacePreviewTarget = {
      path: 'results/table.csv',
      sessionId: 'session-owner',
      surfaceId: 'right-panel-surface-2'
    }
    // @ts-expect-error Exact Host surface targeting cannot also create a new pane.
    const ambiguousTarget: DomainWorkbenchRightPanelTarget = {
      placement: 'new',
      surfaceId: 'right-panel-surface-2'
    }

    assert.deepEqual(defaultTarget, {})
    assert.equal(domainWorkbenchRightPanelPlacementSchema.parse(rightPanel.placement), 'new')
    assert.equal(domainWorkbenchRightPanelPlacementSchema.parse(preview.placement), 'focused')
    assert.equal(exactPreview.surfaceId, 'right-panel-surface-2')
    assert.equal(ambiguousTarget.placement, 'new')
    assert.equal(domainWorkbenchRightPanelPlacementSchema.safeParse('replace-all').success, false)
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
    const issuerEpoch = 'issuer-00000000000000000000000000000000'
    const deliveryAttemptId = `delivery-attempt:${issuerEpoch}:1:00000000000000000000000000000000`
    const before: DomainMainBeforeTurnEvent = {
      kind: 'before-turn',
      state: 'starting',
      issuerEpoch,
      deliveryAttemptOrdinal: 1,
      deliveryAttemptId,
      boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
      clientDirectiveId: 'directive-1',
      runtimeId: 'runtime-1',
      threadId: 'thread-1',
      workspaceRoot: '/workspace',
      occurredAt: '2026-07-28T00:00:00.000Z'
    }
    const after: DomainMainAfterTurnEvent = {
      kind: 'after-turn',
      state: 'completed',
      issuerEpoch,
      deliveryAttemptOrdinal: 1,
      deliveryAttemptId,
      boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
      clientDirectiveId: 'directive-1',
      runtimeId: 'runtime-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceRoot: '/workspace',
      occurredAt: '2026-07-28T00:00:01.000Z'
    }

    assert.equal(before.kind, 'before-turn')
    assert.equal(after.turnId, 'turn-1')
  })

  it('lets the Host sanitize opaque settings secrets without disclosing them', () => {
    const sanitizer: DomainMainTextSanitizerHost = {
      sanitizeText: (value) => value.replaceAll('opaque-setting-secret', '[REDACTED]')
    }

    assert.equal(
      sanitizer.sanitizeText('result opaque-setting-secret'),
      'result [REDACTED]'
    )
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
    const capabilityChange: DomainRendererCapabilityChange = {
      resourceRef: 'resource-ref-1',
      resourceKind: 'fixture.state',
      origin: 'capability',
      actionId: 'fixture.state.refresh',
      beforeRevision: 'revision-1',
      afterRevision: 'revision-2',
      changedAt: '2026-07-28T00:00:00.000Z'
    }
    const providerChange: DomainRendererCapabilityChange = {
      resourceRef: 'resource-ref-1',
      resourceKind: 'fixture.state',
      origin: 'provider',
      beforeRevision: 'revision-2',
      afterRevision: 'revision-3',
      changedAt: '2026-07-28T00:00:01.000Z'
    }
    listener?.(capabilityChange)
    listener?.(providerChange)
    assert.equal(capabilityChange.actionId, 'fixture.state.refresh')
    assert.equal('actionId' in providerChange, false)
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
