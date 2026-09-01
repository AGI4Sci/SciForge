import { createElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import type {
  DomainRendererHost,
  DomainRendererSessionResource
} from '@sciforge/domain-sdk/host'

import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND
} from '../contract.js'
import {
  CONTENT_SPACE_RENDERER_COMMAND_CONTRIBUTION,
  CONTENT_SPACE_RENDERER_I18N_CONTRIBUTION,
  CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  CONTENT_SPACE_RENDERER_WORKSPACE_FILES_CONTRACT,
  CONTENT_SPACE_RENDERER_WORKSPACE_FILES_CONTRIBUTION
} from '../definition.js'
import {
  createContentSpaceRightPanelContribution,
  createContentSpaceResourceNavigationContribution,
  createDomainRendererEntry,
  findContentSpaceActivationResource
} from './index.js'
import {
  CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
  CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION,
  type ContentSpaceProviderEnrollmentView
} from './provider-enrollment-view.js'

describe('Content Space renderer activation', () => {
  it('publishes Files as an embedded Collaboration Center section without another toolbar entry', () => {
    const entry = createDomainRendererEntry(rendererHost())
    expect(entry.contributions.map(({ id }) => id)).toEqual([
      CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
      CONTENT_SPACE_RENDERER_COMMAND_CONTRIBUTION.id,
      CONTENT_SPACE_RENDERER_WORKSPACE_FILES_CONTRIBUTION.id,
      CONTENT_SPACE_RENDERER_I18N_CONTRIBUTION.id,
      CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION.id
    ])
    expect(entry.contributions.some(({ kind }) => (
      kind === 'renderer.workbench-toolbar-action'
    ))).toBe(false)

    const files = entry.contributions.find(({ id }) => (
      id === CONTENT_SPACE_RENDERER_WORKSPACE_FILES_CONTRIBUTION.id
    ))!
    expect(files.contract).toEqual(CONTENT_SPACE_RENDERER_WORKSPACE_FILES_CONTRACT)
    const value = files.value as Readonly<{
      icon: unknown
      render(input: {
        active: boolean
        className: string
        session: { id: string; workspaceRoot?: string }
      }): ReactElement<Record<string, unknown>>
    }>
    expect(value.icon).toBeTruthy()
    const rendered = value.render({
      active: true,
      className: 'embedded-files',
      session: { id: 'session-1', workspaceRoot: 'workspace-1' }
    })
    expect(rendered.props.embedded).toBe(true)
    expect(rendered.props.className).toBe('embedded-files')
    expect(rendered.props.workspaceId).toBe('workspace-1')
  })

  it('injects installed Provider enrollment views into the package-owned panel', () => {
    const enrollmentView: ContentSpaceProviderEnrollmentView = Object.freeze({
      contractVersion: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
      providerKind: 'fixture-content-space',
      readAccessState: async () => ({ status: 'ready' as const }),
      render: () => createElement('div')
    })
    const host: DomainRendererHost = {
      ...rendererHost(),
      contributions: {
        list: (kind) => kind === 'renderer.extension'
          ? [{
              id: 'fixture.enrollment',
              kind,
              packageName: '@fixture/provider',
              owner: { moduleId: 'fixture.provider', moduleVersion: '1.0.0' },
              contract: {
                location: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION,
                contractVersion: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
                providerKind: 'fixture-content-space'
              },
              value: enrollmentView
            }]
          : []
      }
    }

    const rendered = createContentSpaceRightPanelContribution(host).render({
      active: true,
      focused: true,
      surfaceId: 'content-space-panel',
      className: 'host-panel',
      session: { id: 'session-1' },
      onCollapse: () => undefined
    }) as ReactElement<{ enrollmentViews?: readonly ContentSpaceProviderEnrollmentView[] }>

    expect(rendered.props.enrollmentViews).toEqual([enrollmentView])
  })

  it('selects exactly one session resource by both resource kind and resource id', () => {
    const container = sessionResource(CONTENT_CONTAINER_RESOURCE_KIND, 'same-id', 'container')
    const file = sessionResource(CONTENT_FILE_RESOURCE_KIND, 'same-id', 'file')

    expect(findContentSpaceActivationResource({
      resourceKind: CONTENT_FILE_RESOURCE_KIND,
      resourceId: 'same-id'
    }, [container, file])).toEqual(file)
    expect(findContentSpaceActivationResource({
      resourceKind: ARTIFACT_RESOURCE_KIND,
      resourceId: 'same-id'
    }, [container, file])).toBeUndefined()
  })

  it('fails closed for duplicate, malformed, or unknown activation resources', () => {
    const first = sessionResource(CONTENT_FILE_RESOURCE_KIND, 'file-id', 'first')
    const duplicate = sessionResource(CONTENT_FILE_RESOURCE_KIND, 'file-id', 'second')

    expect(findContentSpaceActivationResource({
      resourceKind: CONTENT_FILE_RESOURCE_KIND,
      resourceId: 'file-id'
    }, [first, duplicate])).toBeUndefined()
    expect(findContentSpaceActivationResource({
      resourceKind: CONTENT_FILE_RESOURCE_KIND,
      resourceId: 'file-id',
      providerInstanceRef: 'must-not-be-trusted'
    }, [first])).toBeUndefined()
    expect(findContentSpaceActivationResource({
      resourceKind: 'vendor.drive.file',
      resourceId: 'file-id'
    }, [first])).toBeUndefined()
  })

  it('navigates only the three declared Content Space resource kinds without inspecting metadata', () => {
    const navigation = createContentSpaceResourceNavigationContribution()
    const materialized = sessionResource(
      CONTENT_FILE_RESOURCE_KIND,
      'res_materialized-review-resource',
      'review'
    )

    expect(navigation.resolve({
      sessionId: 'session-content-space',
      resource: {
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        resourceId: 'container-portable-id'
      }
    })).toEqual({
      activation: {
        revision: 1,
        payload: {
          resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
          resourceId: 'container-portable-id'
        }
      }
    })
    expect(navigation.resolve({
      sessionId: 'session-content-space',
      resource: {
        resourceKind: CONTENT_FILE_RESOURCE_KIND,
        resourceId: materialized.resourceRef,
        resourceRef: materialized.resourceRef
      }
    })).toEqual({
      activation: {
        revision: 1,
        payload: {
          resourceKind: CONTENT_FILE_RESOURCE_KIND,
          resourceId: materialized.resourceRef,
          materializedResourceRef: materialized.resourceRef
        }
      }
    })
    expect(findContentSpaceActivationResource({
      resourceKind: CONTENT_FILE_RESOURCE_KIND,
      resourceId: materialized.resourceRef,
      materializedResourceRef: materialized.resourceRef
    })).toEqual({
      kind: CONTENT_FILE_RESOURCE_KIND,
      resourceRef: materialized.resourceRef
    })
    expect(navigation.resolve({
      sessionId: 'session-content-space',
      resource: {
        resourceKind: CONTENT_FILE_RESOURCE_KIND,
        resourceId: materialized.resourceRef,
        resourceRef: 'res_different-materialized-reference'
      }
    })).toBeNull()
    expect(navigation.resolve({
      sessionId: 'session-content-space',
      resource: {
        resourceKind: 'application/pdf',
        resourceId: 'looks-like-a-content-space-file'
      }
    })).toBeNull()
  })
})

function rendererHost(): DomainRendererHost {
  return {
    capabilityInvoker: {
      bind: async () => { throw new Error('not used') },
      observe: async () => { throw new Error('not used') },
      invoke: async () => { throw new Error('not used') }
    },
    openExternal: () => undefined
  }
}

function sessionResource<Kind extends
    | typeof CONTENT_CONTAINER_RESOURCE_KIND
    | typeof CONTENT_FILE_RESOURCE_KIND
    | typeof ARTIFACT_RESOURCE_KIND>(
  kind: Kind,
  resourceRef: string,
  handleSuffix: string
): DomainRendererSessionResource & Readonly<{ kind: Kind }> {
  return Object.freeze({
    kind,
    resourceRef,
    resource: Object.freeze({
      token: `cap_${handleSuffix.padEnd(20, 'x')}`,
      semanticRevision: 'revision-1',
      expiresAt: '2026-08-16T12:00:00.000Z'
    })
  })
}
