import { randomUUID } from 'node:crypto'
import type { ProviderLocator } from '@sciforge/collaboration-contracts'
import { ZulipProviderError } from './errors.js'

export type ZulipLocator = Omit<
  ProviderLocator,
  'provider' | 'containerDisplayName' | 'topicDisplayName'
> & {
  provider: 'zulip'
  containerDisplayName: string
  topicDisplayName: string
}

export type ZulipLocatorBinding = {
  bindingId: string
  revision: number
  locator: ZulipLocator
}

export type ZulipIncomingCoordinates = {
  realmId: string
  containerId: string
  topicDisplayName: string
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new ZulipProviderError('invalid_locator', `${field} is required.`)
  return normalized
}

function displayKey(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('und')
}

function coordinatesKey(input: ZulipIncomingCoordinates): string {
  return [
    nonEmpty(input.realmId, 'realmId'),
    nonEmpty(input.containerId, 'containerId'),
    displayKey(nonEmpty(input.topicDisplayName, 'topicDisplayName'))
  ].join('\u0000')
}

export function createZulipLocator(input: {
  realmId: string
  streamId: string
  streamName: string
  topicName: string
  topicId?: string
}): ZulipLocator {
  return {
    type: 'provider_locator',
    provider: 'zulip',
    realmId: nonEmpty(input.realmId, 'realmId'),
    containerId: nonEmpty(input.streamId, 'streamId'),
    topicId: nonEmpty(input.topicId ?? `zulip-topic-${randomUUID()}`, 'topicId'),
    containerDisplayName: nonEmpty(input.streamName, 'streamName'),
    topicDisplayName: nonEmpty(input.topicName, 'topicName')
  }
}

export class ZulipLocatorIndex {
  private readonly bindings = new Map<string, ZulipLocatorBinding>()

  replaceAll(bindings: readonly ZulipLocatorBinding[]): void {
    this.bindings.clear()
    for (const binding of bindings) this.upsert(binding)
  }

  upsert(binding: ZulipLocatorBinding): void {
    const bindingId = nonEmpty(binding.bindingId, 'bindingId')
    if (!Number.isSafeInteger(binding.revision) || binding.revision < 1) {
      throw new ZulipProviderError('invalid_locator', 'Locator revision must be a positive integer.')
    }
    if (binding.locator.provider !== 'zulip') {
      throw new ZulipProviderError('invalid_locator', 'Locator provider must be zulip.')
    }
    createZulipLocator({
      realmId: binding.locator.realmId,
      streamId: binding.locator.containerId,
      streamName: binding.locator.containerDisplayName,
      topicName: binding.locator.topicDisplayName,
      topicId: binding.locator.topicId
    })
    this.bindings.set(bindingId, { ...binding, bindingId })
  }

  remove(bindingId: string): void {
    this.bindings.delete(bindingId.trim())
  }

  resolve(input: ZulipIncomingCoordinates, expectedRevision?: number): ZulipLocatorBinding {
    const key = coordinatesKey(input)
    const candidates = [...this.bindings.values()].filter((binding) => coordinatesKey({
      realmId: binding.locator.realmId,
      containerId: binding.locator.containerId,
      topicDisplayName: binding.locator.topicDisplayName
    }) === key)
    if (candidates.length === 0) {
      throw new ZulipProviderError('locator_missing', 'No active binding matches the Zulip location.')
    }
    if (candidates.length !== 1) {
      throw new ZulipProviderError('locator_ambiguous', 'More than one active binding matches the Zulip location.', {
        detail: { candidateCount: candidates.length }
      })
    }
    const resolved = candidates[0]!
    if (expectedRevision !== undefined && expectedRevision !== resolved.revision) {
      throw new ZulipProviderError(
        'locator_revision_mismatch',
        'The saved Zulip locator revision no longer matches the requested binding.',
        { detail: { expectedRevision, actualRevision: resolved.revision } }
      )
    }
    return resolved
  }

  relocate(input: {
    bindingId: string
    expectedRevision: number
    streamId?: string
    streamName?: string
    topicName?: string
  }): ZulipLocatorBinding {
    const current = this.bindings.get(nonEmpty(input.bindingId, 'bindingId'))
    if (!current) throw new ZulipProviderError('locator_missing', 'Zulip locator binding does not exist.')
    if (current.revision !== input.expectedRevision) {
      throw new ZulipProviderError('locator_revision_mismatch', 'Zulip locator changed before this operation.', {
        detail: { expectedRevision: input.expectedRevision, actualRevision: current.revision }
      })
    }
    const next: ZulipLocatorBinding = {
      bindingId: current.bindingId,
      revision: current.revision + 1,
      locator: createZulipLocator({
        realmId: current.locator.realmId,
        streamId: input.streamId ?? current.locator.containerId,
        streamName: input.streamName ?? current.locator.containerDisplayName,
        topicName: input.topicName ?? current.locator.topicDisplayName,
        topicId: current.locator.topicId
      })
    }
    this.bindings.set(next.bindingId, next)
    return next
  }
}
