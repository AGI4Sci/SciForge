import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  auditRoot,
  walkFiles
} from './collaboration-secret-audit.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots = []

test.afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

test('accepts private authorities and explicit non-authorizing protocol values', () => {
  const root = cleanFixture()
  const result = auditFixture(root)

  assert.deepEqual(result.findings, [])
  assert.ok(result.scannedFiles >= 8)
})

test('rejects raw authority in public contracts, IPC, logs, and receipts', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/opencontent-connector/src/contract.ts', `
    import { z } from 'zod'
    export const openContentConnectionTargetInputSchema = z.object({
      providerInstanceRef: z.string()
    })
    export const openContentBindInputSchema = z.object({
      providerInstanceRef: z.string(),
      password: z.string()
    })
  `)
  write(root, 'packages/domains/collaboration/src/renderer/index.tsx', `
    const accessToken = obtainAuthority()
    export function send(invoker) {
      return invoker.invoke('collaboration.command', { accessToken })
    }
  `)
  write(root, 'packages/collaboration-server/src/service.ts', `
    const agentCredential = readPrivateAuthority()
    console.log(agentCredential)
    const evidenceReceipt = { token: agentCredential }
    storeEvidenceReceipt(evidenceReceipt)
  `)

  const kinds = new Set(auditFixture(root).findings.map(({ kind }) => kind))
  assert.ok(kinds.has('provider-public-enrollment-not-secret-free'))
  assert.ok(kinds.has('public-secret-authority-provider-credential'))
  assert.ok(kinds.has('public-secret-authority-token'))
  assert.ok(kinds.has('secret-ipc'))
  assert.ok(kinds.has('secret-log'))
  assert.ok(kinds.has('secret-receipt'))
})

test('rejects secret-shaped Git material, sensitive files, and production literals', () => {
  const root = cleanFixture()
  const modelPrefix = ['s', 'k-'].join('')
  write(
    root,
    'packages/domains/collaboration/.env',
    `MODEL_API_KEY=${modelPrefix}${'A'.repeat(32)}\n`
  )
  write(root, 'packages/domains/identity-access/src/main/private-session.ts', `
    const accessToken = 'live-authority-material-1234567890'
    export function useSession() { return accessToken.length }
  `)

  const kinds = new Set(auditFixture(root).findings.map(({ kind }) => kind))
  assert.ok(kinds.has('sensitive-file-name'))
  assert.ok(kinds.has('model-credential-shaped-value'))
  assert.ok(kinds.has('literal-secret-assignment'))
})

test('rejects the removed Host credential path and missing native composition', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/opencontent-connector/src/main/index.ts', `
    export function createDomainMainEntry(host) {
      return createOpenContentConnectionService({
        credentials: host.packageSecrets.providerCredentials
      })
    }
  `)

  const kinds = new Set(auditFixture(root).findings.map(({ kind }) => kind))
  assert.ok(kinds.has('provider-host-credential-path'))
  assert.ok(kinds.has('provider-native-enrollment-not-composed'))
})

test('the current meeting-loop security boundary passes the enhanced gate', () => {
  const result = auditRoot({ root: repositoryRoot })

  assert.deepEqual(result.findings, [])
  assert.equal(result.scope, 'meeting-loop-security-boundary')
  assert.ok(result.scannedFiles > 100)
})

function cleanFixture() {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-secret-audit-'))
  temporaryRoots.push(root)

  write(root, 'package.json', JSON.stringify({
    name: 'secret-audit-fixture',
    workspaces: [
      'packages/collaboration-contracts',
      'packages/domains/opencontent-connector'
    ]
  }))
  write(root, 'packages/domains/opencontent-connector/package.json', JSON.stringify({
    name: '@sciforge/domain-opencontent-connector',
    exports: {
      './contract': './src/contract.ts',
      './main': './src/main/index.ts',
      './renderer/enrollment': './src/renderer/enrollment-renderer.ts'
    }
  }))
  write(root, 'packages/domains/opencontent-connector/src/contract.ts', `
    import { z } from 'zod'
    export const openContentConnectionTargetInputSchema = z.object({
      providerInstanceRef: z.string()
    })
    export const openContentBindInputSchema = openContentConnectionTargetInputSchema
  `)
  write(root, 'packages/domains/opencontent-connector/src/main/index.ts', `
    import { createNativeOpenContentPrivateAccountRuntime } from './native-enrollment/index.js'
    export function createDomainMainEntry() {
      return createNativeOpenContentPrivateAccountRuntime
    }
  `)
  write(
    root,
    'packages/domains/opencontent-connector/src/main/native-enrollment/native/opencontent_native_enrollment.mm',
    `
      #include <node_api.h>
      #import <AppKit/AppKit.h>
      #import <Security/Security.h>
      auto keychainClass = kSecClassGenericPassword;
      auto accessibility = kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
      auto synchronize = kSecAttrSynchronizable: @NO;
    `
  )
  write(
    root,
    'packages/domains/opencontent-connector/src/main/native-enrollment/native-binding.ts',
    `
      export function loadPrivateNativeBinding() {
        return './native/build/Release/opencontent_native_enrollment.node'
      }
    `
  )
  write(root, 'packages/domains/opencontent-connector/src/renderer/client.ts', `
    export function bind(providerInstanceRef: string) {
      return { providerInstanceRef }
    }
  `)
  write(root, 'packages/domains/identity-access/src/contract.ts', `
    import { z } from 'zod'
    export const identityCapabilityResourceHandleSchema = z.object({
      token: z.string(),
      expiresAt: z.string()
    })
  `)
  write(root, 'packages/collaboration-contracts/src/protocol.ts', `
    export type AgentRegistered = {
      sealedCredential: string
      credentialBootstrapPublicKey: string
    }
  `)
  write(root, 'packages/domains/content-space/src/contract.ts', `
    export const unavailable = { authorization: 'not_granted' as const }
    export type TemplateState = { templateToken: string }
  `)

  return root
}

function auditFixture(root) {
  return auditRoot({ root, files: walkFiles(root) })
}

function write(root, file, source) {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source, 'utf8')
}
