import {
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  contentSpaceExternalBindingAttestationSchema,
  contentSpaceFileDescendantProofEvidenceSchema,
  contentSpaceFileDescendantProofLimitsSchema,
  contentSpacePageRequestSchema,
  defineContentSpaceProvider,
  type ContentSpaceEntrySummary,
  type ContentSpaceFileDescendantProofEvidence,
  type ContentSpaceOperation,
  type ContentSpaceProvider,
  type ContentSpaceProviderFileDescendantProofInput
} from '@sciforge/domain-content-space/contract'
import {
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'
import type { OpenContentContentSpaceFacade } from '@sciforge/domain-opencontent-connector/main-contract'
import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

import { createOpenContentAdministrationFeature } from './administration.js'
import {
  fromOpenContentExternalBinding,
  toOpenContentExpectedBinding
} from './external-binding.js'
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
}>): ContentSpaceProvider {
  const providerInstanceRef = providerInstanceRefSchema.parse(input.providerInstanceRef)
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
        facade: input.facade
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
        throw mapProviderReadError(error)
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
    proveFileDescendant: (proofInput) => proveOpenContentFileDescendant({
      ...proofInput,
      facade: input.facade,
      providerInstanceRef
    }),
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
        assertCommittedOpenContentGuid(created.folderGuid)
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
        throw mapProviderWriteError(error)
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
        assertCommittedOpenContentGuid(uploaded.fileGuid)
        const observation = uploaded.writeAfterObservation
        if (observation.parentFolderGuid !== parent.containerId ||
          observation.fileGuid !== uploaded.fileGuid ||
          observation.name !== name ||
          observation.size !== source.size) {
          throw new ContentSpaceOperationError({
            code: 'outcome_unknown',
            message: 'The OpenContent write-after observation does not match the upload.',
            retry: 'never'
          })
        }
        const reference = Object.freeze({
          providerInstanceRef,
          fileId: uploaded.fileGuid
        })
        return Object.freeze({
          invocationId: context.invocationId,
          parent,
          name,
          sourceSize: source.size,
          reference,
          writeAfterObservation: Object.freeze({
            parent,
            reference,
            name: observation.name,
            size: observation.size
          })
        })
      } catch (error) {
        throw mapProviderWriteError(error)
      }
    },
    authorizeDownload: async ({ context, reference }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      assertInstance(reference.providerInstanceRef, providerInstanceRef)
      try {
        const expectedBindingAttestation = toOpenContentExpectedBinding(context)
          .expectedBindingAttestation
        if (!expectedBindingAttestation) {
          throw new ContentSpaceOperationError({
            code: 'unauthorized',
            message: 'The exact current OpenContent binding is required for download.',
            retry: 'after-human-action'
          })
        }
        const connectorLease = await input.facade.authorizeDownload({
          principal: context.principal,
          providerInstanceRef: context.providerInstanceRef,
          expectedBindingAttestation,
          fileGuid: reference.fileId,
          signal: context.signal,
          assertPrincipalCurrent: context.assertPrincipalCurrent
        })
        return Object.freeze({
          consume: async ({ destination }) => {
            try {
              await context.assertPrincipalCurrent()
              const downloaded = await connectorLease.consume({
                write: destination.write
              })
              await context.assertPrincipalCurrent()
              return Object.freeze({
                invocationId: context.invocationId,
                reference,
                bytesWritten: downloaded.bytesWritten
              })
            } catch (error) {
              throw mapProviderReadError(error)
            }
          },
          retire: () => connectorLease.retire()
        })
      } catch (error) {
        throw mapProviderReadError(error)
      }
    },
    resolvePortalTarget: async () => blocked(),
    observeImmutableVersion: async () => blocked()
  })
}

async function proveOpenContentFileDescendant(
  input: ContentSpaceProviderFileDescendantProofInput & Readonly<{
    facade: OpenContentContentSpaceFacade
    providerInstanceRef: string
  }>
): Promise<ContentSpaceFileDescendantProofEvidence> {
  const { context, root, candidate, limits } = input
  assertInstance(context.providerInstanceRef, input.providerInstanceRef)
  if (root.providerInstanceRef !== input.providerInstanceRef ||
    candidate.providerInstanceRef !== input.providerInstanceRef) {
    throw proofFailure('invalid_reference')
  }
  assertOpenContentFolderGuid(root.containerId)
  assertOpenContentFileGuid(candidate.fileId)
  if (!contentSpaceFileDescendantProofLimitsSchema.safeParse(limits).success) {
    throw proofFailure('invalid_input')
  }

  const expectedBinding = contentSpaceExternalBindingAttestationSchema.safeParse(
    context.expectedExternalBinding
  )
  if (!expectedBinding.success) throw proofFailure('unauthorized')
  const expectedBindingInput = toOpenContentExpectedBinding(context)
  const expectedBindingAttestation = expectedBindingInput.expectedBindingAttestation
  if (expectedBindingAttestation === undefined) {
    throw proofFailure('unauthorized')
  }

  const startedAt = performance.now()
  const proofTimeout = AbortSignal.timeout(limits.deadlineMs)
  const proofSignal = AbortSignal.any([context.signal, proofTimeout])
  const elapsed = (): number => Math.max(0, performance.now() - startedAt)
  const assertProofCurrent = async (): Promise<void> => {
    if (context.signal.aborted) throw proofFailure('cancelled')
    if (elapsed() > limits.deadlineMs) throw proofFailure('bounds_exceeded')
    try {
      await context.assertPrincipalCurrent()
    } catch {
      throw proofFailure('unauthorized')
    }
    if (context.signal.aborted) throw proofFailure('cancelled')
    if (elapsed() > limits.deadlineMs) throw proofFailure('bounds_exceeded')
  }
  const awaitProofStep = async <T>(operation: () => Promise<T>): Promise<T> => {
    await assertProofCurrent()
    try {
      const result = await operation()
      await assertProofCurrent()
      return result
    } catch (error) {
      if (context.signal.aborted) throw proofFailure('cancelled')
      if (proofTimeout.aborted || elapsed() > limits.deadlineMs) {
        throw proofFailure('bounds_exceeded')
      }
      throw error
    }
  }

  const rootIdentity = hierarchyIdentity('container', root.containerId)
  const candidateIdentity = hierarchyIdentity('file', candidate.fileId)
  const observedIdentities = new Set([rootIdentity, candidateIdentity])
  const observedEdges: Array<Readonly<{
    child: HierarchyEntry
    parent: Readonly<{ kind: 'container'; resourceGuid: string }>
  }>> = []
  let current = Object.freeze({
    kind: 'file' as 'file' | 'container',
    resourceGuid: candidate.fileId
  })
  let depth = 0
  const pages = 0

  try {
    const currentBinding = await awaitProofStep(() =>
      input.facade.useHierarchyProofSession({
        principal: context.principal,
        providerInstanceRef: context.providerInstanceRef,
        expectedBindingAttestation,
        signal: proofSignal,
        assertPrincipalCurrent: context.assertPrincipalCurrent
      }, async (session) => {
        while (true) {
          if (depth >= limits.maxDepth) throw proofFailure('bounds_exceeded')
          if (pages > limits.maxPages || observedIdentities.size > limits.maxNodes) {
            throw proofFailure('bounds_exceeded')
          }
          const rawFact: unknown = await awaitProofStep(() =>
            session.observeEntryParent({
              kind: current.kind,
              resourceGuid: current.resourceGuid
            }))
          const fact = parseExactParentFact(rawFact, current)
          if (fact.parent === undefined) throw proofFailure('invalid_reference')
          observedEdges.push(Object.freeze({ child: fact.child, parent: fact.parent }))
          depth += 1

          const parentIdentity = hierarchyIdentity('container', fact.parent.resourceGuid)
          if (parentIdentity === rootIdentity) break
          if (observedIdentities.has(parentIdentity)) throw proofFailure('invalid_reference')
          if (observedIdentities.size >= limits.maxNodes) {
            throw proofFailure('bounds_exceeded')
          }
          observedIdentities.add(parentIdentity)
          current = Object.freeze({
            kind: 'container' as const,
            resourceGuid: fact.parent.resourceGuid
          })
        }

        // OpenContent does not expose a hierarchy snapshot/version. Re-observe
        // every accepted edge in this one bound session so a reparent during
        // the walk cannot be accepted as proof of the old ancestry.
        for (const edge of observedEdges) {
          const rawFact: unknown = await awaitProofStep(() =>
            session.observeEntryParent({
              kind: edge.child.kind,
              resourceGuid: edge.child.resourceGuid
            }))
          const revalidated = parseExactParentFact(rawFact, edge.child)
          if (revalidated.parent === undefined ||
            revalidated.parent.resourceGuid !== edge.parent.resourceGuid) {
            throw proofFailure('invalid_reference')
          }
        }

        const rawRoot: unknown = await awaitProofStep(() => session.observeContainer({
          resourceGuid: root.containerId
        }))
        assertExactRootObservation(rawRoot, root.containerId)

        const binding = fromOpenContentExternalBinding(session.bindingAttestation, context)
        if (binding.externalSubject !== expectedBinding.data.externalSubject ||
          binding.bindingRevision !== expectedBinding.data.bindingRevision) {
          throw proofFailure('unauthorized')
        }
        return binding
      }))
    const elapsedMs = elapsed()
    if (elapsedMs > limits.deadlineMs) throw proofFailure('bounds_exceeded')
    return contentSpaceFileDescendantProofEvidenceSchema.parse(Object.freeze({
      invocationId: context.invocationId,
      providerInstanceRef: input.providerInstanceRef,
      authority: input.providerInstanceRef,
      root,
      candidate,
      binding: currentBinding,
      counts: Object.freeze({
        depth,
        pages,
        nodes: observedIdentities.size,
        elapsedMs
      }),
      provedAt: new Date().toISOString(),
      cacheable: false,
      portable: false
    }))
  } catch (error) {
    if (error instanceof ContentSpaceOperationError) throw error
    if (error instanceof OpenContentConnectorError) throw mapConnectorError(error)
    throw providerFailure('provider_unavailable')
  }
}

type HierarchyEntry = Readonly<{
  kind: 'container' | 'file'
  resourceGuid: string
}>

function parseExactParentFact(
  rawFact: unknown,
  expectedChild: HierarchyEntry
): Readonly<{
  child: HierarchyEntry
  parent?: Readonly<{ kind: 'container'; resourceGuid: string }>
}> {
  if (!isRecord(rawFact) ||
    !Object.prototype.hasOwnProperty.call(rawFact, 'child') ||
    !hasOnlyKeys(rawFact, ['child', 'parent']) ||
    !isHierarchyEntry(rawFact.child) ||
    rawFact.child.kind !== expectedChild.kind ||
    rawFact.child.resourceGuid !== expectedChild.resourceGuid) {
    throw proofFailure('provider_contract_violation')
  }
  if (rawFact.parent === undefined) {
    return Object.freeze({ child: rawFact.child })
  }
  if (!isRecord(rawFact.parent) || !hasOnlyKeys(rawFact.parent, ['kind', 'resourceGuid']) ||
    rawFact.parent.kind !== 'container' ||
    typeof rawFact.parent.resourceGuid !== 'string' ||
    rawFact.parent.resourceGuid.trim() !== rawFact.parent.resourceGuid ||
    rawFact.parent.resourceGuid.length < 1 ||
    rawFact.parent.resourceGuid.length > 256 ||
    /^\d+$/u.test(rawFact.parent.resourceGuid)) {
    throw proofFailure('provider_contract_violation')
  }
  return Object.freeze({
    child: rawFact.child,
    parent: Object.freeze({
      kind: 'container' as const,
      resourceGuid: rawFact.parent.resourceGuid
    })
  })
}

function isHierarchyEntry(value: unknown): value is HierarchyEntry {
  return isRecord(value) &&
    hasOnlyKeys(value, ['kind', 'resourceGuid']) &&
    (value.kind === 'container' || value.kind === 'file') &&
    typeof value.resourceGuid === 'string' &&
    value.resourceGuid.trim() === value.resourceGuid &&
    value.resourceGuid.length >= 1 &&
    value.resourceGuid.length <= 256 &&
    !/^\d+$/u.test(value.resourceGuid)
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hierarchyIdentity(kind: HierarchyEntry['kind'], resourceGuid: string): string {
  return `${kind}:${resourceGuid}`
}

function assertExactRootObservation(raw: unknown, rootGuid: string): void {
  if (!isRecord(raw) ||
    !hasOnlyKeys(raw, ['kind', 'folderGuid', 'label']) ||
    raw.kind !== 'container' ||
    raw.folderGuid !== rootGuid ||
    typeof raw.label !== 'string') {
    throw proofFailure('provider_contract_violation')
  }
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

function assertOpenContentFileGuid(value: string): void {
  if (/^\d+$/u.test(value)) throw proofFailure('invalid_input')
}

function assertCommittedOpenContentGuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 256 ||
    /^\d+$/u.test(value)) {
    throw new ContentSpaceOperationError({
      code: 'outcome_unknown',
      message: 'The OpenContent write receipt cannot be bound to a canonical resource.',
      retry: 'never'
    })
  }
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
        ? 'Reconnect OpenContent for the current Principal.'
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

function mapProviderReadError(error: unknown): ContentSpaceOperationError {
  if (error instanceof ContentSpaceOperationError) return error
  if (error instanceof OpenContentConnectorError) return mapConnectorError(error)
  return providerFailure('provider_unavailable')
}

function mapProviderWriteError(error: unknown): ContentSpaceOperationError {
  if (error instanceof ContentSpaceOperationError) return error
  if (error instanceof OpenContentConnectorError) return mapConnectorError(error)
  return new ContentSpaceOperationError({
    code: 'outcome_unknown',
    message: 'The OpenContent write outcome cannot be proven.',
    retry: 'never'
  })
}

function proofFailure(
  code:
    | 'invalid_input'
    | 'invalid_reference'
    | 'provider_contract_violation'
    | 'unauthorized'
    | 'bounds_exceeded'
    | 'cancelled'
): ContentSpaceOperationError {
  const messages = {
    invalid_input: 'The OpenContent descendant proof input is invalid.',
    invalid_reference: 'The OpenContent file is not an authorized descendant of this root.',
    provider_contract_violation: 'OpenContent returned an invalid hierarchy fact.',
    unauthorized: 'The current OpenContent binding cannot prove this hierarchy.',
    bounds_exceeded: 'The OpenContent descendant proof exceeded its fixed bounds.',
    cancelled: 'The OpenContent descendant proof was cancelled.'
  } as const
  return new ContentSpaceOperationError({
    code,
    message: messages[code],
    retry: code === 'unauthorized' ? 'after-human-action' : 'never'
  })
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
