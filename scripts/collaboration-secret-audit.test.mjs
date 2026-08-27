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

test('rejects an arbitrary invoke method even when it uses the former canonical file and symbol names', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/opencontent-connector/src/renderer/client.ts', `
    export function bind(
      invoker: { invoke(contract: unknown, input: unknown): Promise<unknown> },
      password: string
    ) {
      return invoker.invoke({ actionId: 'opencontent.connection.bind' }, { password })
    }
  `)

  assert.ok(auditFixture(root).findings.some(({ kind }) => kind === 'secret-ipc'))
})

test('rejects a typed renderer capability invoke when its registered metadata is not sensitive', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/opencontent-connector/src/main/connection-capabilities.ts', `
    export const bind = {
      id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      audiences: ['ui'],
      tags: ['opencontent', 'provider-connection'],
      inputSchema: openContentBindInputSchema
    }
  `)
  write(root, 'packages/domains/opencontent-connector/src/renderer/client.ts', `
    import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
    import {
      OPENCONTENT_CONNECTION_CAPABILITY_IDS,
      openContentBindInputSchema
    } from '../contract.js'

    export function bind(
      invoker: DomainRendererCapabilityInvoker,
      account: string,
      password: string
    ) {
      const contract = {
        actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
        effect: 'external-write',
        inputSchema: openContentBindInputSchema,
        outputSchema: openContentBindInputSchema
      }
      return invoker.invoke(contract, { account, password })
    }
  `)

  assert.ok(auditFixture(root).findings.some(({ kind }) => kind === 'secret-ipc'))
})

test('rejects renderer-authored sensitive metadata that is absent from domain main', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/opencontent-connector/src/main/connection-capabilities.ts', `
    export const bind = {
      id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      tags: ['provider-connection'],
      inputSchema: openContentBindInputSchema
    }
  `)
  write(root, 'packages/domains/opencontent-connector/src/renderer/client.ts', `
    import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
    import {
      OPENCONTENT_CONNECTION_CAPABILITY_IDS,
      openContentBindInputSchema
    } from '../contract.js'
    const fakeRegistration = {
      id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      tags: ['sensitive-input'],
      inputSchema: openContentBindInputSchema
    }
    export function bind(invoker: DomainRendererCapabilityInvoker, password: string) {
      const contract = {
        actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
        effect: 'external-write',
        inputSchema: openContentBindInputSchema,
        outputSchema: openContentBindInputSchema
      }
      return invoker.invoke(contract, { password })
    }
  `)

  assert.ok(auditFixture(root).findings.some(({ kind }) => kind === 'secret-ipc'))
})

test('accepts a registered sensitive capability through the public renderer invoker without package exceptions', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/collaboration/src/contract.ts', `
    import { z } from 'zod'
    export const EXAMPLE_CAPABILITY_IDS = { bind: 'example.account.bind' } as const
    export const exampleBindInputSchema = z.object({
      account: z.string(),
      password: z.string()
    }).strict().readonly()
    export const exampleBindOutputSchema = z.object({ connected: z.boolean() }).strict()
  `)
  write(root, 'packages/domains/collaboration/src/main.ts', `
    import {
      EXAMPLE_CAPABILITY_IDS,
      exampleBindInputSchema,
      exampleBindOutputSchema
    } from './contract.js'
    export const bind = {
      id: EXAMPLE_CAPABILITY_IDS.bind,
      audiences: ['ui'],
      tags: ['sensitive-input'],
      inputSchema: exampleBindInputSchema,
      outputSchema: exampleBindOutputSchema
    }
  `)
  write(root, 'packages/domains/collaboration/src/renderer/client.ts', `
    import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
    import {
      EXAMPLE_CAPABILITY_IDS,
      exampleBindInputSchema,
      exampleBindOutputSchema
    } from '../contract.js'
    export function bind(
      invoker: DomainRendererCapabilityInvoker,
      credentials: { account: string; password: string }
    ) {
      const contract = {
        actionId: EXAMPLE_CAPABILITY_IDS.bind,
        effect: 'external-write',
        inputSchema: exampleBindInputSchema,
        outputSchema: exampleBindOutputSchema
      }
      return invoker.invoke(contract, credentials)
    }
  `)

  const findings = auditFixture(root).findings.filter(({ file }) => (
    file.startsWith('packages/domains/collaboration/')
  ))
  assert.deepEqual(findings, [])
})

test('treats an account extracted from a password credential bundle as sensitive', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/collaboration/src/renderer/credential-form.ts', `
    export function leak(credentials: { account: string; password: string }) {
      const { account } = credentials
      console.log(account)
      localStorage.setItem('last-account', account)
      storeEvidenceReceipt({ account })
    }
  `)

  const kinds = new Set(auditFixture(root).findings.map(({ kind }) => kind))
  assert.ok(kinds.has('secret-log'))
  assert.ok(kinds.has('secret-plaintext-persistence'))
  assert.ok(kinds.has('secret-receipt'))
})

test('treats a separately collected account as sensitive once it joins a password bundle', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/collaboration/src/renderer/credential-form.ts', `
    export function submit(submittedAccount: string, password: string) {
      const credentials = { account: submittedAccount, password }
      console.log(submittedAccount)
      return credentials
    }
  `)

  assert.ok(auditFixture(root).findings.some(({ kind }) => kind === 'secret-log'))
})

test('rejects a credential-linked account embedded directly in a receipt', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/collaboration/src/renderer/credential-form.ts', `
    export function submit(submittedAccount: string, password: string) {
      const credentials = { account: submittedAccount, password }
      const enrollmentReceipt = { account: submittedAccount }
      return { credentials, enrollmentReceipt }
    }
  `)

  assert.ok(auditFixture(root).findings.some(({ kind }) => kind === 'secret-receipt'))
})

test('keeps account and username non-secret outside a credential bundle', () => {
  const root = cleanFixture()
  const file = 'packages/domains/collaboration/src/renderer/member-label.ts'
  write(root, file, `
    export function reportMember(account: string, username: string) {
      console.info({ account, username })
      return username || account
    }
  `)

  assert.deepEqual(
    auditFixture(root).findings.filter((finding) => finding.file === file),
    []
  )
})

test('rejects sensitive authority outside the one-use bind contract, IPC, logs, and receipts', () => {
  const root = cleanFixture()
  write(root, 'packages/domains/opencontent-connector/src/contract.ts', `
    import { z } from 'zod'
    export const OPENCONTENT_CONNECTION_CAPABILITY_IDS = {
      bind: 'opencontent.connection.bind'
    } as const
    export const openContentConnectionTargetInputSchema = z.object({
      providerInstanceRef: z.string()
    })
    export const openContentBindInputSchema = z.object({
      providerInstanceRef: z.string(),
      account: z.string(),
      password: z.string()
    }).strict().readonly()
    export const openContentStatusInputSchema = z.object({
      accessToken: z.string()
    }).strict()
  `)
  write(root, 'packages/domains/collaboration/src/renderer/index.tsx', `
    const accessToken = obtainAuthority()
    export function send(invoker) {
      localStorage.setItem('authority', accessToken)
      return invoker.invoke('collaboration.command', { accessToken })
    }
  `)
  write(root, 'packages/collaboration-server/src/service.ts', `
    const agentCredential = readPrivateAuthority()
    console.log(agentCredential)
    const evidenceReceipt = { token: agentCredential }
    storeEvidenceReceipt(evidenceReceipt)
    settings.write({ agentCredential })
  `)

  const kinds = new Set(auditFixture(root).findings.map(({ kind }) => kind))
  assert.ok(kinds.has('public-secret-authority-token'))
  assert.ok(kinds.has('secret-ipc'))
  assert.ok(kinds.has('secret-log'))
  assert.ok(kinds.has('secret-receipt'))
  assert.ok(kinds.has('secret-plaintext-persistence'))
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
    export const openContentBindInputSchema = z.object({
      providerInstanceRef: z.string(),
      account: z.string(),
      password: z.string()
    }).strict().readonly()
  `)
  write(root, 'packages/domains/opencontent-connector/src/main/index.ts', `
    import { createOpenContentPrivateAccountRuntime } from './provider-credential-runtime.js'
    export function createDomainMainEntry(host) {
      return createOpenContentPrivateAccountRuntime({
        credentials: host.packageSecrets?.providerCredentials
      })
    }
  `)
  write(root, 'packages/domains/opencontent-connector/src/main/connection-capabilities.ts', `
    import {
      OPENCONTENT_CONNECTION_CAPABILITY_IDS,
      openContentBindInputSchema
    } from '../contract.js'
    export const defaults = { audiences: ['ui'] }
    export const bind = {
      id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      tags: ['opencontent', 'provider-connection', 'sensitive-input'],
      inputSchema: openContentBindInputSchema
    }
  `)
  write(root, 'packages/domains/opencontent-connector/src/main/provider-credential-runtime.ts', `
    import type { DomainMainProviderCredentialStoreHost } from '@sciforge/domain-sdk/package-storage'
    export function createOpenContentPrivateAccountRuntime(
      credentials: DomainMainProviderCredentialStoreHost
    ) {
      return {
        enroll: (access, token) => credentials.replace(access, token),
        withSession: (access, operation) => credentials.use(access, operation)
      }
    }
  `)
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
