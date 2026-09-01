import { describe, expect, it, vi } from 'vitest'

import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  CONTENT_SPACE_CAPABILITY_IDS,
  type ContentFileReference
} from '../contract.js'
import { createContentSpaceCapabilityClient } from './capability-client.js'

const fileReference: ContentFileReference = Object.freeze({
  providerInstanceRef: 'mock.instance.one',
  fileId: 'paper.pdf'
})

describe('Content Space renderer capability client', () => {
  it('opens a Provider portal only through the resolved opaque handle and approval boundary', async () => {
    const signal = new AbortController().signal
    const approval = Object.freeze({ mode: 'confirmation' as const })
    const handle = `portal_${'a'.repeat(32)}`
    const invoke = vi.fn(async (contract: Readonly<{ actionId: string }>) => {
      if (contract.actionId === CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget) {
        return {
          ok: true,
          value: { handle, expiresAt: '2026-08-16T12:00:00.000Z' }
        }
      }
      return { ok: true, value: { opened: true } }
    })
    const client = createContentSpaceCapabilityClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await expect(client.openPortal(fileReference, { approval, signal })).resolves.toEqual({
      ok: true,
      value: { opened: true }
    })

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0]).toEqual([
      expect.objectContaining({
        actionId: CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget,
        effect: 'read'
      }),
      { reference: fileReference },
      { signal }
    ])
    expect(invoke.mock.calls[1]).toEqual([
      expect.objectContaining({
        actionId: CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget,
        effect: 'external-write'
      }),
      { handle },
      { approval, signal }
    ])
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('https://')
  })

  it('fails closed when portal target resolution fails', async () => {
    const failure = {
      ok: false as const,
      error: {
        code: 'unsafe_portal_target' as const,
        message: 'The Provider portal target is unsafe.',
        retry: 'never' as const
      }
    }
    const invoke = vi.fn(async () => failure)
    const client = createContentSpaceCapabilityClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await expect(client.openPortal(fileReference, {
      approval: { mode: 'confirmation' }
    })).resolves.toEqual(failure)
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('rejects a portable observation whose materialized reference drifts from its resource kind', async () => {
    const observe = vi.fn(async () => ({
      revision: 'revision-1',
      state: {
        reference: {
          ...fileReference,
          immutableVersionId: 'immutable-v1'
        },
        entry: {
          kind: 'file' as const,
          reference: fileReference,
          label: 'paper.pdf',
          size: 128
        },
        capabilities: []
      }
    }))
    const client = createContentSpaceCapabilityClient({
      invoke: vi.fn(),
      observe
    } as unknown as DomainRendererCapabilityInvoker)

    await expect(client.observeResource({
      resourceKind: CONTENT_FILE_RESOURCE_KIND,
      resource: resourceHandle('portable-file')
    })).rejects.toThrow(/kind drifted/iu)
    expect(observe).toHaveBeenCalledOnce()
  })

  it('forwards cancellation to portable resource observation', async () => {
    const signal = new AbortController().signal
    const observe = vi.fn(async () => ({ revision: 'revision-1', state: null }))
    const client = createContentSpaceCapabilityClient({
      invoke: vi.fn(),
      observe
    } as unknown as DomainRendererCapabilityInvoker)

    await (client.observeResource as (
      input: Parameters<typeof client.observeResource>[0],
      options?: Readonly<{ signal?: AbortSignal }>
    ) => ReturnType<typeof client.observeResource>)({
      resourceKind: ARTIFACT_RESOURCE_KIND,
      resource: resourceHandle('portable-artifact')
    }, { signal })

    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ resourceKind: ARTIFACT_RESOURCE_KIND }),
      resourceHandle('portable-artifact'),
      { signal }
    )
  })
})

function resourceHandle(suffix: string) {
  return Object.freeze({
    token: `cap_${suffix.padEnd(20, 'x')}`,
    semanticRevision: 'revision-1',
    expiresAt: '2026-08-16T12:00:00.000Z'
  })
}
