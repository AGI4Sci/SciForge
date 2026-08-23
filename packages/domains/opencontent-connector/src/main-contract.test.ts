import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import * as mainContract from './main-contract.js'
import {
  docflowCommandInvocationSchema,
  isOpenContentSupplierMutationCommand,
  openContentExtendedCommandInvocationSchema,
  type OpenContentExtendedOperationCommand,
  type OpenContentSupplierCommandTransport
} from './main-contract.js'

// @ts-expect-error Managed output callbacks are not part of the Provider contract.
import type { DocflowManagedOutputWrite } from './main-contract.js'
// @ts-expect-error Transport parser implementation aliases are not public contracts.
import type { DocflowTransportResult } from './main-contract.js'
// @ts-expect-error Extended success parser aliases are not public contracts.
import type { OpenContentExtendedCommandSuccess } from './main-contract.js'
// @ts-expect-error Tests derive this from the public schema instead of widening the contract.
import type { OpenContentExtendedCommandInvocation } from './main-contract.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('OpenContent Connector main contract', () => {
  it('classifies supplier write uncertainty through one shared contract boundary', () => {
    expect(isOpenContentSupplierMutationCommand('rename')).toBe(true)
    expect(isOpenContentSupplierMutationCommand('docflow-create')).toBe(true)
    expect(isOpenContentSupplierMutationCommand('file-info')).toBe(false)
    expect(isOpenContentSupplierMutationCommand('docflow-read')).toBe(false)
  })

  it('rejects the retired user-info supplier command at the public typed schema', () => {
    // @ts-expect-error Current-principal resolution is session-backed, not a supplier command.
    const retiredCommand: OpenContentExtendedOperationCommand = 'user-info'

    expect(openContentExtendedCommandInvocationSchema.safeParse({
      invocationId: 'invocation_retired_user_info_contract',
      command: retiredCommand,
      args: {},
      dataFiles: []
    }).success).toBe(false)
  })

  it('publishes only token-free supplier invocations and the Provider facade', async () => {
    const packageManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))

    expect(packageManifest.exports['./main-contract']).toBe('./src/main-contract.ts')
    expect(Object.keys(packageManifest.exports)).not.toEqual(expect.arrayContaining([
      './main/bundled-assets',
      './main/cli-runner',
      './main/node-cli-process-port',
      './main/verified-runtime-snapshot'
    ]))
    expect(Object.keys(mainContract).sort()).toEqual([
      'DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL',
      'docflowCommandInvocationSchema',
      'docflowNativeDocumentConflictReceiptSchema',
      'docflowNativeDocumentFailureReceiptSchema',
      'docflowNativeDocumentOutcomeUnknownReceiptSchema',
      'docflowNativeDocumentReceiptSchema',
      'docflowNativeDocumentSuccessReceiptSchema',
      'docflowTransportErrorSchema',
      'docflowTransportResultSchema',
      'isOpenContentSupplierMutationCommand',
      'openContentExtendedCommandInvocationSchema',
      'openContentExtendedCommandSuccessSchema'
    ].sort())

    const invoke = vi.fn<OpenContentSupplierCommandTransport['invoke']>()
    const transport: OpenContentSupplierCommandTransport = { invoke }
    const docflow = docflowCommandInvocationSchema.parse({
      invocationId: 'invocation_connector_contract_docflow',
      command: 'docflow-read',
      args: { fileId: 'file-a' },
      dataFiles: []
    })
    const extended = openContentExtendedCommandInvocationSchema.parse({
      invocationId: 'invocation_connector_contract_extended',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    })

    await transport.invoke(docflow)
    await transport.invoke(extended)

    expect(invoke).toHaveBeenNthCalledWith(1, docflow)
    expect(invoke).toHaveBeenNthCalledWith(2, extended)
    expect(JSON.stringify([docflow, extended])).not.toMatch(
      /token|password|authorization|entrypoint|executable|argv|environment/iu
    )
  })
})
