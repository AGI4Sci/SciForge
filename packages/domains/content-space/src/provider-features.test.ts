import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
} from './extended-operations-contract.js'
import {
  contentSpaceExtendedOperationStateListSchema,
  contentSpaceNativeDocumentOperationStateListSchema,
  contentSpaceProviderNativeDocumentReceiptSchema,
  extendedOperationAuthority,
  extendedOperationEffect,
  nativeDocumentOperationEffect,
  nativeDocumentRequestTarget
} from './provider-features.js'
import { contentSpaceProviderFeaturesSchema } from './provider-features-schema.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const CONTAINER = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  containerId: 'root'
})
const FILE = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  fileId: 'document-one'
})

describe('Content Space provider feature ports', () => {
  it('accepts only the exact independent feature executors and contextual admin binder', () => {
    const nativeExecute = vi.fn()
    const describeNativeOperations = vi.fn(() => [{
      operation: 'read' as const,
      readiness: 'production_ready' as const,
      reasonCode: 'available' as const
    }])
    const extendedExecute = vi.fn()
    const describeOperations = vi.fn(() => [{
      operation: 'updateFileVersion' as const,
      readiness: 'poc_only' as const,
      reasonCode: 'verification_profile_required' as const
    }])
    const administrationBind = vi.fn()
    const describeAdministrationOperations = vi.fn(() => [])

    expect(contentSpaceProviderFeaturesSchema.parse({
      nativeDocuments: { describeOperations: describeNativeOperations, execute: nativeExecute },
      extendedOperations: { describeOperations, execute: extendedExecute },
      administration: {
        describeOperations: describeAdministrationOperations,
        bind: administrationBind
      }
    })).toEqual({
      nativeDocuments: { describeOperations: describeNativeOperations, execute: nativeExecute },
      extendedOperations: { describeOperations, execute: extendedExecute },
      administration: {
        describeOperations: describeAdministrationOperations,
        bind: administrationBind
      }
    })
    expect(() => contentSpaceProviderFeaturesSchema.parse({
      nativeDocuments: { describeOperations: describeNativeOperations, execute: nativeExecute, rawClient: {} }
    })).toThrow()
    expect(() => contentSpaceProviderFeaturesSchema.parse({
      executeNativeDocument: nativeExecute
    })).toThrow()
    expect(() => contentSpaceProviderFeaturesSchema.parse({
      nativeDocuments: { execute: nativeExecute }
    })).toThrow()
    expect(() => contentSpaceProviderFeaturesSchema.parse({
      extendedOperations: { execute: extendedExecute }
    })).toThrow()
    expect(() => contentSpaceProviderFeaturesSchema.parse({
      administration: { listSpaces: vi.fn() }
    })).toThrow()
    expect(() => contentSpaceProviderFeaturesSchema.parse({
      administration: { bind: administrationBind }
    })).toThrow()
  })

  it('validates exact per-operation readiness without duplicates or implicit promotion', () => {
    expect(contentSpaceNativeDocumentOperationStateListSchema.parse([{
      operation: 'read',
      readiness: 'poc_only',
      reasonCode: 'verification_profile_required'
    }])).toHaveLength(1)
    expect(() => contentSpaceNativeDocumentOperationStateListSchema.parse([{
      operation: 'read',
      readiness: 'production_ready',
      reasonCode: 'verification_profile_required'
    }])).toThrow()
    expect(() => contentSpaceNativeDocumentOperationStateListSchema.parse([
      {
        operation: 'read',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'read',
        readiness: 'blocked_by_contract',
        reasonCode: 'provider_contract_missing'
      }
    ])).toThrow()

    expect(contentSpaceExtendedOperationStateListSchema.parse([{
      operation: 'updateFileVersion',
      readiness: 'poc_only',
      reasonCode: 'verification_profile_required'
    }])).toHaveLength(1)
    expect(() => contentSpaceExtendedOperationStateListSchema.parse([{
      operation: 'updateFileVersion',
      readiness: 'production_ready',
      reasonCode: 'verification_profile_required'
    }])).toThrow()
    expect(() => contentSpaceExtendedOperationStateListSchema.parse([
      {
        operation: 'updateFileVersion',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'updateFileVersion',
        readiness: 'blocked_by_contract',
        reasonCode: 'provider_contract_missing'
      }
    ])).toThrow()
  })

  it('owns the fixed native-document effect and primary-target matrix', () => {
    expect(nativeDocumentOperationEffect('read')).toBe('read')
    expect(nativeDocumentOperationEffect('update')).toBe('external-write')
    expect(nativeDocumentOperationEffect('image-download')).toBe('workspace-write')
    expect(nativeDocumentOperationEffect('export')).toBe('workspace-write')
    expect(nativeDocumentOperationEffect('comment-delete')).toBe('destructive')

    expect(nativeDocumentRequestTarget({
      operation: 'create',
      resourceType: 'native_document',
      parent: CONTAINER,
      title: 'Draft',
      content: { encoding: 'json', value: { type: 'doc' } }
    })).toEqual(CONTAINER)
    expect(nativeDocumentRequestTarget({
      operation: 'read',
      document: { resourceType: 'native_document', reference: FILE }
    })).toEqual(FILE)
  })

  it('accepts provider artifact metadata but never a forged Host transfer handle', () => {
    const receipt = {
      contractVersion: '1.0.0',
      resourceType: 'native_document',
      operation: 'export',
      invocationId: 'invocation_native_export_0001',
      outcome: 'succeeded',
      result: {
        kind: 'artifact',
        name: 'draft.pdf',
        mediaType: 'application/pdf',
        bytesWritten: 12
      }
    }
    expect(contentSpaceProviderNativeDocumentReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(() => contentSpaceProviderNativeDocumentReceiptSchema.parse({
      ...receipt,
      result: {
        ...receipt.result,
        transferHandle: 'xfer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }
    })).toThrow()
  })

  it('keeps every extended effect aligned with the contracted operation matrix', () => {
    for (const [operation, contract] of Object.entries(
      CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
    )) {
      expect(extendedOperationEffect(
        operation as keyof typeof CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
      )).toBe(contract.effect)
    }
  })

  it('derives extended effects from the canonical operation contract', async () => {
    vi.resetModules()
    vi.doMock('./extended-operations-contract.js', async (importOriginal) => {
      const actual = await importOriginal<
        typeof import('./extended-operations-contract.js')
      >()
      return {
        ...actual,
        CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS: Object.freeze({
          ...actual.CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
          searchEntries: Object.freeze({
            ...actual.CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS.searchEntries,
            effect: 'destructive' as const
          })
        })
      }
    })

    try {
      const providerFeatures = await import('./provider-features.js')
      expect(providerFeatures.extendedOperationEffect('searchEntries')).toBe('destructive')
    } finally {
      vi.doUnmock('./extended-operations-contract.js')
      vi.resetModules()
    }
  })

  it('extracts exact entry and provider authority anchors without guessing', () => {
    expect(extendedOperationAuthority('getEntryInfo', { reference: FILE })).toEqual({
      kind: 'entry',
      reference: FILE
    })
    expect(extendedOperationAuthority('listRecentEntries', {
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    })).toEqual({
      kind: 'provider',
      providerInstanceRef: PROVIDER_INSTANCE_REF
    })
    expect(extendedOperationAuthority('copyEntries', {
      entries: [FILE],
      destination: CONTAINER
    })).toEqual({ kind: 'entry', reference: CONTAINER })
    expect(extendedOperationAuthority('removeAttachment', {
      master: FILE,
      attachment: { ...FILE, fileId: 'attachment-one' }
    })).toEqual({
      kind: 'entry',
      reference: { ...FILE, fileId: 'attachment-one' }
    })
  })
})
