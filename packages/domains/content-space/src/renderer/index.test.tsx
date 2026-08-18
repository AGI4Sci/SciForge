import { describe, expect, it } from 'vitest'

import type { DomainRendererSessionResource } from '@sciforge/domain-sdk/host'

import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND
} from '../contract.js'
import {
  createContentSpaceResourceNavigationContribution,
  findContentSpaceActivationResource
} from './index.js'

describe('Content Space renderer activation', () => {
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
        resourceKind: 'application/pdf',
        resourceId: 'looks-like-a-content-space-file'
      }
    })).toBeNull()
  })
})

function sessionResource(
  kind: string,
  resourceRef: string,
  token: string
): DomainRendererSessionResource {
  return Object.freeze({
    kind,
    resourceRef,
    resource: Object.freeze({
      token,
      semanticRevision: 'revision-1',
      expiresAt: '2026-08-16T12:00:00.000Z'
    })
  })
}
