import { isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type {
  DomainRendererCapabilityInvoker,
  DomainRendererHost
} from '@sciforge/domain-sdk/host'
import {
  CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
  CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION,
  type ContentSpaceProviderAccessState
} from '@sciforge/domain-content-space/renderer'
import {
  type OpenContentConnectionResult
} from '@sciforge/domain-opencontent-connector/contract'

import {
  OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRACT,
  OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION
} from '../definition.js'
import {
  createDomainRendererEntry,
  createOpenContentContentSpaceEnrollmentView
} from './index.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'test-opencontent-provider'

describe('OpenContent Content Space enrollment renderer adapter', () => {
  it('contributes one value that exactly matches the declared renderer extension contract', () => {
    const entry = createDomainRendererEntry(rendererHost(async () => disconnectedResult))

    expect(entry.contributions).toHaveLength(1)
    expect(entry.contributions[0]).toMatchObject({
      id: OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION.id,
      kind: OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRIBUTION.kind,
      contract: OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRACT,
      value: {
        contractVersion: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION,
        providerKind: 'opencontent'
      }
    })
    expect(Object.keys(entry.contributions[0]?.value as object).sort()).toEqual([
      'contractVersion',
      'providerKind',
      'readAccessState',
      'render'
    ])
    expect(OPENCONTENT_CONTENT_SPACE_ENROLLMENT_CONTRACT).toMatchObject({
      location: CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION
    })
  })

  it.each([
    [connectedResult(), 'ready'],
    [disconnectedResult, 'human_action_required'],
    [reauthenticationRequiredResult(), 'human_action_required'],
    [typedFailure, 'unavailable']
  ] as const)(
    'maps the Connector status envelope to %s access without leaking Provider detail',
    async (result, expectedStatus) => {
      const invoke = vi.fn(async () => result)
      const view = createOpenContentContentSpaceEnrollmentView(rendererHost(invoke))
      const signal = new AbortController().signal

      await expect(view.readAccessState({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        signal
      })).resolves.toEqual({
        status: expectedStatus,
        viewState: {
          phase: 'resolved',
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          result
        }
      })
      expect(invoke).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'opencontent.connection.status' }),
        { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF },
        { signal }
      )
    }
  )

  it('fails closed when status throws or returns a connection for another instance', async () => {
    const unexpected = createOpenContentContentSpaceEnrollmentView(rendererHost(
      async () => { throw new Error('socket 10.0.0.4 secret diagnostic') }
    ))
    await expect(unexpected.readAccessState({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: new AbortController().signal
    })).resolves.toEqual({
      status: 'unavailable',
      viewState: {
        phase: 'unavailable',
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
      }
    })

    const drifted = createOpenContentContentSpaceEnrollmentView(rendererHost(async () => ({
      outcome: 'success' as const,
      status: {
        ...connectedResult().status,
        providerInstanceRef: 'another-opencontent-instance'
      }
    })))
    await expect(drifted.readAccessState({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: new AbortController().signal
    })).resolves.toEqual({
      status: 'unavailable',
      viewState: {
        phase: 'resolved',
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        result: expect.objectContaining({ outcome: 'success' })
      }
    })
  })

  it('does not start a status capability after Content Space cancels the access read', async () => {
    const invoke = vi.fn(async () => connectedResult())
    const view = createOpenContentContentSpaceEnrollmentView(rendererHost(invoke))
    const controller = new AbortController()
    controller.abort()

    await expect(view.readAccessState({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: controller.signal
    })).resolves.toEqual({
      status: 'unavailable',
      viewState: {
        phase: 'unavailable',
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
      }
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('passes the single access result to the Connector fragment without another status read', async () => {
    const invoke = vi.fn(async () => disconnectedResult)
    const view = createOpenContentContentSpaceEnrollmentView(
      rendererHost(invoke)
    )
    const accessState: ContentSpaceProviderAccessState = await view.readAccessState({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: new AbortController().signal
    })
    const onAccessChanged = vi.fn()
    const element = view.render({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accessState,
      onAccessChanged
    })

    expect(isValidElement(element)).toBe(true)
    const props = element.props as Record<string, unknown>
    expect(props).toMatchObject({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      onConnectionChanged: onAccessChanged,
      viewState: accessState.viewState
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(props.client).toBeDefined()
    expect(Object.keys(props).sort()).toEqual([
      'client',
      'onConnectionChanged',
      'providerInstanceRef',
      'viewState'
    ])
  })
})

const disconnectedResult = Object.freeze({
  outcome: 'success' as const,
  status: Object.freeze({ state: 'disconnected' as const })
})

const typedFailure = Object.freeze({
  outcome: 'error' as const,
  error: Object.freeze({
    code: 'provider_unavailable' as const,
    action: 'retry' as const
  })
})

function connectedResult() {
  return {
    outcome: 'success',
    status: {
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }
  } as const satisfies OpenContentConnectionResult
}

function reauthenticationRequiredResult(): OpenContentConnectionResult {
  return {
    outcome: 'success',
    status: {
      ...connectedResult().status,
      state: 'reauthentication_required'
    }
  }
}

function rendererHost(
  invoke: (...args: readonly unknown[]) => Promise<unknown>
): DomainRendererHost {
  return {
    capabilityInvoker: {
      invoke: invoke as DomainRendererCapabilityInvoker['invoke'],
      observe: vi.fn()
    },
    openExternal: vi.fn()
  }
}
