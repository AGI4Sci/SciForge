import {
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  contentSpacePageRequestSchema,
  defineContentSpaceProvider,
  type ContentSpaceEntrySummary,
  type ContentSpaceOperation,
  type ContentSpaceProvider
} from '@sciforge/domain-content-space/contract'
import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OpenContentConnectorError,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'

import { createOpenContentAdministrationFeature } from './administration.js'
import {
  fromOpenContentExternalBinding,
  toOpenContentExpectedBinding
} from './external-binding.js'
import type { OpenContentIdentityBindingPort } from './identity-binding.js'
import { createOpenContentRuntimeFeatures } from './runtime-features.js'

const OPERATIONS = Object.freeze([
  'list-containers',
  'list-entries',
  'observe-entry',
  'create-folder',
  'upload-new',
  'download',
  'portal-target',
  'observe-immutable-version'
] as const satisfies readonly ContentSpaceOperation[])
const ORDINARY_OPERATIONS = Object.freeze([
  'list-containers',
  'list-entries',
  'observe-entry',
  'create-folder',
  'upload-new',
  'download'
] as const satisfies readonly ContentSpaceOperation[])

export function createOpenContentContentSpaceProvider(input: Readonly<{
  providerInstanceRef: string
  facade: OpenContentContentSpaceFacade
  identities?: OpenContentIdentityBindingPort
}>): ContentSpaceProvider {
  const providerInstanceRef = input.providerInstanceRef
  assertInstance(providerInstanceRef, OPENCONTENT_PROVIDER_INSTANCE_REF)
  const runtimeFeatures = createOpenContentRuntimeFeatures({
    providerInstanceRef,
    facade: input.facade
  })
  const blocked = (): never => {
    throw new ContentSpaceOperationError({
      code: 'blocked_by_contract',
      message: 'This OpenContent operation has not passed its exact contract gate.',
      retry: 'never'
    })
  }
  return defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    features: Object.freeze({
      administration: createOpenContentAdministrationFeature({
        providerInstanceRef,
        facade: input.facade,
        ...(input.identities === undefined ? {} : { identities: input.identities })
      }),
      ...runtimeFeatures
    }),
    attestExternalBinding: async (context) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      try {
        const binding = await input.facade.attestExternalBinding({
          principal: context.principal,
          providerInstanceRef: context.providerInstanceRef,
          signal: context.signal,
          assertPrincipalCurrent: context.assertPrincipalCurrent
        })
        return fromOpenContentExternalBinding(binding, context)
      } catch (error) {
        throw mapProviderError(error)
      }
    },
    describeCapabilities: async (context) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      return OPERATIONS.map((operation) => capabilityState(
        operation,
        isOrdinaryOperation(operation)
      ))
    },
    listContainers: async ({ context, page: rawPage }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      const page = contentSpacePageRequestSchema.parse(rawPage)
      let teamPage = parseTeamCursor(page.cursor, Math.min(page.limit, 100))
      try {
        let result: Awaited<ReturnType<OpenContentContentSpaceFacade['listRootFolders']>> | undefined
        let pagesRead = 0
        let settled = false
        while (pagesRead < 100_000) {
          pagesRead += 1
          result = await input.facade.listRootFolders({
            principal: context.principal,
            providerInstanceRef: context.providerInstanceRef,
            ...toOpenContentExpectedBinding(context),
            teamPage: teamPage?.page ?? 1,
            teamPageSize: teamPage?.pageSize ?? Math.min(page.limit, 100),
            includePersonal: teamPage === undefined,
            includeTeams: teamPage !== undefined,
            signal: context.signal,
            assertPrincipalCurrent: context.assertPrincipalCurrent
          })
          if (teamPage === undefined) {
            if (result.roots.length > 0) {
              settled = true
              break
            }
            teamPage = { page: 1, pageSize: Math.min(page.limit, 100), offset: 0 }
            continue
          }
          if (
            result.roots.length > teamPage.pageSize ||
            teamPage.offset > result.roots.length
          ) throw providerFailure('provider_unavailable')
          if (result.roots.length > teamPage.offset || !result.nextTeamPage) {
            settled = true
            break
          }
          if (result.nextTeamPage !== teamPage.page + 1) {
            throw providerFailure('provider_unavailable')
          }
          teamPage = { page: result.nextTeamPage, pageSize: teamPage.pageSize, offset: 0 }
        }
        if (!settled || !result) throw providerFailure('provider_unavailable')
        const selectedRoots = teamPage === undefined
          ? result.roots
          : result.roots.slice(teamPage.offset, teamPage.offset + page.limit)
        const items = selectedRoots.map((root) => Object.freeze({
          reference: Object.freeze({
            providerInstanceRef,
            containerId: root.folderGuid
          }),
          scope: root.source === 'personal-root' ? 'personal' as const : 'shared' as const,
          label: root.label
        }))
        if (items.length > page.limit) throw providerFailure('provider_unavailable')
        const nextTeamCursor = teamPage === undefined
          ? undefined
          : teamPage.offset + selectedRoots.length < result.roots.length
            ? { ...teamPage, offset: teamPage.offset + selectedRoots.length }
            : result.nextTeamPage
              ? { page: result.nextTeamPage, pageSize: teamPage.pageSize, offset: 0 }
              : undefined
        return Object.freeze({
          providerInstanceRef,
          items: Object.freeze(items),
          ...(teamPage === undefined
            ? { nextCursor: 'teams_1' }
            : nextTeamCursor
              ? { nextCursor: formatTeamCursor(nextTeamCursor) }
              : {})
        })
      } catch (error) {
        if (error instanceof ContentSpaceOperationError) throw error
        if (error instanceof OpenContentConnectorError) throw mapConnectorError(error)
        throw providerFailure('provider_unavailable')
      }
    },
    listEntries: async ({ context, parent, page: rawPage }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      if (parent.providerInstanceRef !== providerInstanceRef) throw providerFailure('invalid_input')
      assertOpenContentFolderGuid(parent.containerId)
      const page = contentSpacePageRequestSchema.parse(rawPage)
      let providerPage = parseEntryCursor(page.cursor, Math.min(page.limit, 100))
      try {
        const items: ContentSpaceEntrySummary[] = []
        let nextPage: EntryPageCursor | undefined
        let pagesRead = 0
        while (items.length < page.limit) {
          pagesRead += 1
          if (pagesRead > 100_000) throw providerFailure('provider_unavailable')
          const result = await input.facade.listFolderEntries({
            principal: context.principal,
            providerInstanceRef: context.providerInstanceRef,
            ...toOpenContentExpectedBinding(context),
            parentFolderGuid: parent.containerId,
            page: providerPage.page,
            pageSize: providerPage.pageSize,
            signal: context.signal,
            assertPrincipalCurrent: context.assertPrincipalCurrent
          })
          if (
            result.parentFolderGuid !== parent.containerId ||
            result.entries.length > providerPage.pageSize ||
            providerPage.offset > result.entries.length
          ) throw providerFailure('provider_unavailable')

          const available = result.entries.slice(providerPage.offset)
          const selected = available.slice(0, page.limit - items.length)
          items.push(...selected.map((entry) => entry.kind === 'container'
            ? Object.freeze({
                kind: 'container' as const,
                reference: Object.freeze({
                  providerInstanceRef,
                  containerId: entry.folderGuid
                }),
                label: entry.label
              })
            : Object.freeze({
                kind: 'file' as const,
                reference: Object.freeze({
                  providerInstanceRef,
                  fileId: entry.fileGuid
                }),
                label: entry.label,
                size: entry.size
              })))

          const consumedOffset = providerPage.offset + selected.length
          if (consumedOffset < result.entries.length) {
            nextPage = { ...providerPage, offset: consumedOffset }
            break
          }
          if (result.nextPage !== undefined) {
            if (result.nextPage <= providerPage.page) {
              throw providerFailure('provider_unavailable')
            }
            nextPage = {
              page: result.nextPage,
              pageSize: providerPage.pageSize,
              offset: 0
            }
            if (items.length === page.limit) break
            providerPage = nextPage
            continue
          }
          nextPage = undefined
          break
        }
        return Object.freeze({
          parent,
          items: Object.freeze(items),
          ...(nextPage ? { nextCursor: formatEntryCursor(nextPage) } : {})
        })
      } catch (error) {
        if (error instanceof ContentSpaceOperationError) throw error
        if (error instanceof OpenContentConnectorError) throw mapConnectorError(error)
        throw providerFailure('provider_unavailable')
      }
    },
    observeEntry: async ({ context, reference }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      assertInstance(reference.providerInstanceRef, providerInstanceRef)
      try {
        const container = 'containerId' in reference
        if (container) assertOpenContentFolderGuid(reference.containerId)
        const observed = await input.facade.observeEntry(container
          ? {
              principal: context.principal,
              providerInstanceRef: context.providerInstanceRef,
              ...toOpenContentExpectedBinding(context),
              kind: 'container',
              resourceGuid: reference.containerId,
              signal: context.signal,
              assertPrincipalCurrent: context.assertPrincipalCurrent
            }
          : {
              principal: context.principal,
              providerInstanceRef: context.providerInstanceRef,
              ...toOpenContentExpectedBinding(context),
              kind: 'file',
              resourceGuid: reference.fileId,
              signal: context.signal,
              assertPrincipalCurrent: context.assertPrincipalCurrent
            })
        if (container && observed.kind !== 'container') throw providerFailure('provider_unavailable')
        if (!container && observed.kind !== 'file') throw providerFailure('provider_unavailable')
        const entry = container && observed.kind === 'container'
          ? Object.freeze({ kind: 'container' as const, reference, label: observed.label })
          : !container && observed.kind === 'file'
            ? Object.freeze({
                kind: 'file' as const,
                reference: Object.freeze({
                  providerInstanceRef,
                  fileId: reference.fileId
                }),
                label: observed.label,
                size: observed.size
              })
            : null
        if (!entry) throw providerFailure('provider_unavailable')
        return Object.freeze({
          entry,
          capabilities: OPERATIONS.map((operation) => capabilityState(
            operation,
            operation === 'observe-entry' ||
              (container && ['list-entries', 'create-folder', 'upload-new'].includes(operation)) ||
              (!container && operation === 'download')
          ))
        })
      } catch (error) {
        if (error instanceof ContentSpaceOperationError) throw error
        if (error instanceof OpenContentConnectorError) throw mapConnectorError(error)
        throw providerFailure('provider_unavailable')
      }
    },
    createFolder: async ({ context, parent, name }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      assertInstance(parent.providerInstanceRef, providerInstanceRef)
      assertOpenContentFolderGuid(parent.containerId)
      try {
        const created = await input.facade.createFolder({
          principal: context.principal,
          providerInstanceRef: context.providerInstanceRef,
          ...toOpenContentExpectedBinding(context),
          parentFolderGuid: parent.containerId,
          name,
          signal: context.signal,
          assertPrincipalCurrent: context.assertPrincipalCurrent
        })
        return Object.freeze({
          invocationId: context.invocationId,
          parent,
          name,
          reference: Object.freeze({
            providerInstanceRef,
            containerId: created.folderGuid
          })
        })
      } catch (error) {
        throw mapProviderError(error)
      }
    },
    uploadNewFile: async ({ context, parent, name, source }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      assertInstance(parent.providerInstanceRef, providerInstanceRef)
      assertOpenContentFolderGuid(parent.containerId)
      try {
        const uploaded = await input.facade.uploadNewFile({
          principal: context.principal,
          providerInstanceRef: context.providerInstanceRef,
          ...toOpenContentExpectedBinding(context),
          parentFolderGuid: parent.containerId,
          name,
          size: source.size,
          read: source.read,
          signal: context.signal,
          assertPrincipalCurrent: context.assertPrincipalCurrent
        })
        return Object.freeze({
          invocationId: context.invocationId,
          parent,
          name,
          sourceSize: source.size,
          reference: Object.freeze({
            providerInstanceRef,
            fileId: uploaded.fileGuid
          })
        })
      } catch (error) {
        throw mapProviderError(error)
      }
    },
    downloadFile: async ({ context, reference, destination }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      assertInstance(reference.providerInstanceRef, providerInstanceRef)
      try {
        const downloaded = await input.facade.downloadFile({
          principal: context.principal,
          providerInstanceRef: context.providerInstanceRef,
          ...toOpenContentExpectedBinding(context),
          fileGuid: reference.fileId,
          write: destination.write,
          signal: context.signal,
          assertPrincipalCurrent: context.assertPrincipalCurrent
        })
        return Object.freeze({
          invocationId: context.invocationId,
          reference,
          bytesWritten: downloaded.bytesWritten
        })
      } catch (error) {
        throw mapProviderError(error)
      }
    },
    resolvePortalTarget: async () => blocked(),
    observeImmutableVersion: async () => blocked()
  })
}

function capabilityState(operation: ContentSpaceOperation, implemented: boolean) {
  return implemented
    ? Object.freeze({
        operation,
        readiness: 'poc_only' as const,
        reasonCode: 'verification_profile_required' as const
      })
    : Object.freeze({
        operation,
        readiness: 'blocked_by_contract' as const,
        reasonCode: 'provider_contract_missing' as const
      })
}

function isOrdinaryOperation(operation: ContentSpaceOperation): boolean {
  return (ORDINARY_OPERATIONS as readonly ContentSpaceOperation[]).includes(operation)
}

type TeamPageCursor = Readonly<{
  page: number
  pageSize: number
  offset: number
}>

function parseTeamCursor(cursor: string | undefined, defaultPageSize: number): TeamPageCursor | undefined {
  if (cursor === undefined) return undefined
  const match = /^teams_([1-9]\d*)(?:_([1-9]\d*)(?:_(0|[1-9]\d*))?)?$/u.exec(cursor)
  const page = Number(match?.[1] ?? Number.NaN)
  const pageSize = Number(match?.[2] ?? defaultPageSize)
  const offset = Number(match?.[3] ?? 0)
  if (
    !Number.isSafeInteger(page) || page < 1 || page > 100_000 ||
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset >= pageSize
  ) {
    throw providerFailure('invalid_input')
  }
  return { page, pageSize, offset }
}

function formatTeamCursor(cursor: TeamPageCursor): string {
  const prefix = `teams_${String(cursor.page)}_${String(cursor.pageSize)}`
  return cursor.offset === 0 ? prefix : `${prefix}_${String(cursor.offset)}`
}

type EntryPageCursor = Readonly<{
  page: number
  pageSize: number
  offset: number
}>

function parseEntryCursor(cursor: string | undefined, defaultPageSize: number): EntryPageCursor {
  if (cursor === undefined) return { page: 1, pageSize: defaultPageSize, offset: 0 }
  const current = /^entries_([1-9]\d*)_([1-9]\d*)_(0|[1-9]\d*)$/u.exec(cursor)
  const page = Number(current?.[1] ?? Number.NaN)
  const pageSize = Number(current?.[2] ?? Number.NaN)
  const offset = Number(current?.[3] ?? Number.NaN)
  if (
    !Number.isSafeInteger(page) || page < 1 || page > 100_000 ||
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset >= pageSize
  ) {
    throw providerFailure('invalid_input')
  }
  return { page, pageSize, offset }
}

function formatEntryCursor(cursor: EntryPageCursor): string {
  return `entries_${String(cursor.page)}_${String(cursor.pageSize)}_${String(cursor.offset)}`
}

function assertInstance(actual: string, expected: string): void {
  if (actual !== expected) throw providerFailure('provider_unavailable')
}

function assertOpenContentFolderGuid(value: string): void {
  if (/^\d+$/u.test(value)) throw providerFailure('invalid_input')
}

function mapConnectorError(error: OpenContentConnectorError): ContentSpaceOperationError {
  if (error.code === 'invalid_input') {
    return new ContentSpaceOperationError({
      code: 'invalid_input',
      message: 'The OpenContent target or request is invalid.',
      retry: 'never'
    })
  }
  if (error.code === 'unauthorized' || error.code === 'reauthentication_required') {
    return new ContentSpaceOperationError({
      code: 'unauthorized',
      message: error.code === 'reauthentication_required'
        ? 'Reconnect the current Local Account to OpenContent.'
        : 'The current OpenContent account is not authorized.',
      retry: 'after-human-action'
    })
  }
  if (error.code === 'cancelled') {
    return new ContentSpaceOperationError({
      code: 'cancelled',
      message: 'The OpenContent operation was cancelled.',
      retry: 'never'
    })
  }
  if (error.code === 'rate_limited') {
    return new ContentSpaceOperationError({
      code: 'rate_limited',
      message: 'OpenContent temporarily rate-limited this operation.',
      retry: 'after-human-action'
    })
  }
  if (error.code === 'provider_contract_violation') {
    return new ContentSpaceOperationError({
      code: 'provider_contract_violation',
      message: 'OpenContent returned an unsupported response contract.',
      retry: 'never'
    })
  }
  if (error.code === 'conflict') {
    return new ContentSpaceOperationError({
      code: 'conflict',
      message: 'An OpenContent entry with this name already exists.',
      retry: 'after-human-action'
    })
  }
  if (error.code === 'outcome_unknown') {
    return new ContentSpaceOperationError({
      code: 'outcome_unknown',
      message: 'The OpenContent write outcome cannot be proven.',
      retry: 'never'
    })
  }
  if (error.code === 'bounds_exceeded') {
    return new ContentSpaceOperationError({
      code: 'bounds_exceeded',
      message: 'The OpenContent transfer exceeds the configured bounds.',
      retry: 'never'
    })
  }
  return providerFailure('provider_unavailable')
}

function mapProviderError(error: unknown): ContentSpaceOperationError {
  if (error instanceof ContentSpaceOperationError) return error
  if (error instanceof OpenContentConnectorError) return mapConnectorError(error)
  return providerFailure('provider_unavailable')
}

function providerFailure(
  code: 'invalid_input' | 'provider_unavailable'
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({
    code,
    message: code === 'invalid_input'
      ? 'The OpenContent page request is invalid.'
      : 'The OpenContent Provider result is unavailable.',
    retry: 'never'
  })
}
