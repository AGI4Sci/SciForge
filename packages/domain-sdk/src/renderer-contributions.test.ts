import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  COMPOSER_CONTEXT_LOCATION,
  RENDERER_COMMAND_CONTRIBUTION_KIND,
  RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND,
  RENDERER_EXTENSION_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND,
  WORKBENCH_TOPBAR_LOCATION,
  defineDomainRendererComposerContextProviderContract,
  defineDomainRendererWorkbenchSurfaceContract,
  defineDomainRendererWorkbenchToolbarActionContract,
  domainRendererCommandInvocationSchema,
  domainRendererComposerContextResultSchema,
  domainRendererWorkspacePickResultSchema,
  isDomainRendererCommandActive,
  isDomainRendererCommandAvailable,
  isDomainRendererCommandHandler,
  isDomainRendererComposerContextProvider,
  isDomainRendererWorkbenchSurfaceValue,
  isDomainRendererWorkbenchToolbarActionValue,
  type DomainRendererCommandHandler,
  type DomainRendererCommandInvocation
} from './renderer-contributions.js'

describe('renderer extension contribution contracts', () => {
  it('publishes one generic kind for commands and each renderer slot', () => {
    assert.equal(RENDERER_COMMAND_CONTRIBUTION_KIND, 'renderer.command')
    assert.equal(
      RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND,
      'renderer.workbench-toolbar-action'
    )
    assert.equal(
      RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
      'renderer.workbench-right-panel'
    )
    assert.equal(
      RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND,
      'renderer.workbench-bottom-panel'
    )
    assert.equal(
      RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND,
      'renderer.workbench-global-overlay'
    )
    assert.equal(
      RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND,
      'renderer.composer-context-provider'
    )
    assert.equal(RENDERER_EXTENSION_CONTRIBUTION_KIND, 'renderer.extension')
  })

  it('accepts bounded generic command activation and rejects unknown or non-JSON payloads', () => {
    const invocation = domainRendererCommandInvocationSchema.parse({
      sessionId: 'session-1',
      workspaceRoot: '/workspace',
      resources: [{
        kind: 'fixture.session-state',
        resourceRef: 'resource-ref-1',
        resource: {
          token: 'opaque-token',
          semanticRevision: 'revision-1',
          expiresAt: '2026-07-29T00:00:00.000Z'
        }
      }],
      activeSurface: {
        kind: 'bottom-panel',
        contributionId: 'fixture.bottom-panel'
      },
      payload: {
        artifactId: 'artifact-1',
        selection: [1, 2, 3]
      }
    })

    assert.equal(invocation.activeSurface?.kind, 'bottom-panel')
    assert.deepEqual(invocation.payload, {
      artifactId: 'artifact-1',
      selection: [1, 2, 3]
    })
    assert.throws(
      () => domainRendererCommandInvocationSchema.parse({
        ...invocation,
        undocumented: true
      }),
      z.ZodError
    )
    assert.throws(
      () => domainRendererCommandInvocationSchema.parse({
        payload: { callback: () => undefined }
      }),
      z.ZodError
    )
  })

  it('requires an exact command handler and applies fail-closed status defaults', () => {
    const invocation: DomainRendererCommandInvocation = {}
    const handler: DomainRendererCommandHandler = {
      execute: () => undefined
    }

    assert.equal(isDomainRendererCommandHandler(handler), true)
    assert.equal(isDomainRendererCommandAvailable(handler, invocation), true)
    assert.equal(isDomainRendererCommandActive(handler, invocation), false)
    assert.equal(isDomainRendererCommandHandler({
      ...handler,
      target: 'host-private-mode'
    }), false)
    assert.equal(isDomainRendererCommandHandler({
      execute: () => undefined,
      isAvailable: 'yes'
    }), false)
    assert.equal(isDomainRendererCommandAvailable({
      execute: () => undefined,
      isAvailable: () => {
        throw new Error('unavailable')
      }
    }, invocation), false)
    assert.equal(isDomainRendererCommandActive({
      execute: () => undefined,
      isActive: () => {
        throw new Error('inactive')
      }
    }, invocation), false)
  })

  it('strictly separates toolbar metadata from the command handler', () => {
    const contract = defineDomainRendererWorkbenchToolbarActionContract({
      location: WORKBENCH_TOPBAR_LOCATION,
      commandId: 'fixture.open-panel',
      label: 'Open Fixture'
    })

    assert.deepEqual(contract, {
      location: 'workbench.topbar',
      commandId: 'fixture.open-panel',
      label: 'Open Fixture'
    })
    assert.equal(Object.isFrozen(contract), true)
    assert.equal(isDomainRendererWorkbenchToolbarActionValue({ icon: () => null }), true)
    assert.equal(isDomainRendererWorkbenchToolbarActionValue({
      icon: () => null,
      execute: () => undefined
    }), false)
    assert.throws(
      () => defineDomainRendererWorkbenchToolbarActionContract({
        ...contract,
        target: 'right-panel'
      } as never),
      z.ZodError
    )
  })

  it('uses pure contracts plus one render value shape for all workbench surfaces', () => {
    const right = defineDomainRendererWorkbenchSurfaceContract({
      location: 'workbench.right-panel',
      title: 'Inspector',
      resourceKind: 'fixture.inspection'
    })
    const bottom = defineDomainRendererWorkbenchSurfaceContract({
      location: 'workbench.bottom-panel',
      title: 'Process'
    })
    const overlay = defineDomainRendererWorkbenchSurfaceContract({
      location: 'workbench.global-overlay',
      title: 'Annotations'
    })

    assert.equal(right.location, 'workbench.right-panel')
    assert.equal(bottom.location, 'workbench.bottom-panel')
    assert.equal(overlay.location, 'workbench.global-overlay')
    assert.equal(isDomainRendererWorkbenchSurfaceValue({
      render: () => ({})
    }), true)
    assert.equal(isDomainRendererWorkbenchSurfaceValue({
      id: 'duplicated-manifest-id',
      render: () => ({})
    }), false)
  })

  it('bounds composer context and workspace picker results', () => {
    const contract = defineDomainRendererComposerContextProviderContract({
      location: COMPOSER_CONTEXT_LOCATION,
      label: 'Selected comments'
    })
    assert.equal(contract.location, 'composer.context')
    assert.equal(isDomainRendererComposerContextProvider({
      provide: () => ({ items: [] })
    }), true)
    assert.equal(isDomainRendererComposerContextProvider({
      provide: () => ({ items: [] }),
      queryDom: () => []
    }), false)

    assert.deepEqual(domainRendererComposerContextResultSchema.parse({
      items: [{
        id: 'fixture.selected-comment',
        title: 'Selected comment',
        content: 'Review this registered annotation.',
        metadata: { revision: 1 }
      }]
    }).items[0]?.metadata, { revision: 1 })
    assert.throws(
      () => domainRendererComposerContextResultSchema.parse({
        items: Array.from({ length: 101 }, (_, index) => ({
          id: `fixture.context-${index}`,
          title: 'Context',
          content: 'value'
        }))
      }),
      z.ZodError
    )

    assert.deepEqual(domainRendererWorkspacePickResultSchema.parse({
      canceled: true,
      path: null
    }), { canceled: true, path: null })
    assert.throws(
      () => domainRendererWorkspacePickResultSchema.parse({
        canceled: false,
        path: null
      }),
      z.ZodError
    )
  })
})
