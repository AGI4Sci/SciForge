import {
  RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND,
  domainRendererComposerContextResultSchema,
  type DomainRendererComposerContextProvider,
  type DomainRendererComposerContextProviderContract,
  type DomainRendererComposerContextRequest,
  type DomainRendererComposerContextSearchRequest,
  type DomainRendererComposerContextResult
} from '@sciforge/domain-sdk/renderer'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const COMPOSER_CONTEXT_PROVIDER_SLOT = 'composer.context' as const
export { RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND }

export type ComposerContextProviderContribution =
  DomainRendererComposerContextProviderContract &
  DomainRendererComposerContextProvider &
  Readonly<{ id: string }>

type ComposerContextProviderSlots = {
  [COMPOSER_CONTEXT_PROVIDER_SLOT]: ComposerContextProviderContribution
}

export type RegisteredComposerContextProviderContribution =
  RegisteredRendererSlotContribution<
    ComposerContextProviderSlots,
    typeof COMPOSER_CONTEXT_PROVIDER_SLOT
  >

export class ComposerContextProviderRegistry {
  private readonly slots = new RendererSlotRegistry<ComposerContextProviderSlots>()

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererComposerContextProviderContract
    value: DomainRendererComposerContextProvider
  }>): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: COMPOSER_CONTEXT_PROVIDER_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({
        id: input.id,
        ...input.contract,
        ...(input.value.resolveDraft ? { resolveDraft: async (request: DomainRendererComposerContextRequest) =>
          domainRendererComposerContextResultSchema.parse(await input.value.resolveDraft!(request)) } : {}),
        ...(input.value.active ? { active: async (request: DomainRendererComposerContextRequest) =>
          domainRendererComposerContextResultSchema.parse(await input.value.active!(request)) } : {}),
        ...(input.value.search ? { search: async (request: DomainRendererComposerContextSearchRequest) =>
          domainRendererComposerContextResultSchema.parse(await input.value.search!(request)) } : {}),
        provide: async (
          request: DomainRendererComposerContextRequest
        ): Promise<DomainRendererComposerContextResult> =>
          domainRendererComposerContextResultSchema.parse(
            await input.value.provide(request)
          )
      })
    })
  }

  list(): readonly RegisteredComposerContextProviderContribution[] {
    return this.slots.list(COMPOSER_CONTEXT_PROVIDER_SLOT)
  }

  resolve(
    contributionId: string | null | undefined
  ): RegisteredComposerContextProviderContribution | null {
    const normalized = contributionId?.trim()
    return normalized
      ? this.slots.get(COMPOSER_CONTEXT_PROVIDER_SLOT, normalized)
      : null
  }

  dispose(): void {
    this.slots.dispose()
  }
}
