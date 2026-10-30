import {
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  contentSpaceOperationSchema,
  contentSpacePageRequestSchema,
  defineContentSpaceProvider,
  type ContentSpaceProvider,
  type ContentSpaceProviderOperationContext
} from '@sciforge/domain-content-space/contract'
import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'
import { SiYuanClient, SiYuanError } from './client.js'

/** First phase: notebook discovery only. No unproven file or collaboration claims. */
export function createSiYuanProvider(input: {
  providerInstanceRef: string; client: () => SiYuanClient
}): ContentSpaceProvider {
  const providerInstanceRef = providerInstanceRefSchema.parse(input.providerInstanceRef)
  function fail(code: 'blocked_by_contract' | 'invalid_input' | 'unauthorized' |
    'provider_unavailable' | 'cancelled'): never {
    throw new ContentSpaceOperationError({
      code, retry: 'never', message: `SiYuan provider: ${code}.`
    })
  }
  async function guard(context: ContentSpaceProviderOperationContext) {
    if (context.providerInstanceRef !== providerInstanceRef) fail('invalid_input')
    if (context.signal?.aborted || Date.parse(context.deadlineAt) <= Date.now() ||
      !Number.isFinite(Date.parse(context.deadlineAt))) fail('cancelled')
    await context.assertPrincipalCurrent()
  }
  const blocked = async (): Promise<never> => fail('blocked_by_contract')
  return defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    async attestExternalBinding(context) {
      await guard(context)
      // SiYuan's shared token cannot attest a distinct remote identity for each user.
      return undefined
    },
    async describeCapabilities(context) {
      await guard(context)
      return contentSpaceOperationSchema.options.map((operation) => ({
        operation,
        readiness: operation === 'list-containers' ? 'poc_only' : 'blocked_by_contract',
        reasonCode: operation === 'list-containers'
          ? 'runtime_authorization_required' : 'provider_contract_missing'
      }))
    },
    async listContainers({ context, page }) {
      await guard(context)
      const request = contentSpacePageRequestSchema.parse(page)
      const offset = request.cursor === undefined ? 0 : Number(request.cursor)
      if (!Number.isSafeInteger(offset) || offset < 0 ||
        (request.cursor !== undefined && String(offset) !== request.cursor)) fail('invalid_input')
      let notebooks
      try {
        // Captured Host principal guard is checked immediately before each dispatch.
        await guard(context)
        const deadline = AbortSignal.timeout(Math.max(1, Date.parse(context.deadlineAt) - Date.now()))
        const signal = context.signal ? AbortSignal.any([context.signal, deadline]) : deadline
        notebooks = (await input.client().listNotebooks(signal))
          .filter((notebook) => !notebook.closed)
          .sort((a, b) => a.id.localeCompare(b.id))
        await guard(context)
      } catch (error) {
        if (error instanceof ContentSpaceOperationError) throw error
        fail(error instanceof SiYuanError && error.code === 'unauthorized'
          ? 'unauthorized' : 'provider_unavailable')
      }
      if (offset > notebooks.length) fail('invalid_input')
      const selected = notebooks.slice(offset, offset + request.limit)
      return {
        providerInstanceRef,
        items: selected.map((notebook) => ({
          reference: { providerInstanceRef, containerId: notebook.id },
          scope: 'personal' as const, label: notebook.name
        })),
        ...(offset + selected.length < notebooks.length
          ? { nextCursor: String(offset + selected.length) } : {})
      }
    },
    listEntries: blocked,
    observeEntry: blocked,
    proveFileDescendant: blocked,
    createFolder: blocked,
    uploadNewFile: blocked,
    authorizeDownload: blocked,
    resolvePortalTarget: blocked,
    observeImmutableVersion: blocked
  })
}
