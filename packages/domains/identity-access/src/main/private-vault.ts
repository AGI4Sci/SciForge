import { createHash } from 'node:crypto'

import { agentIdSchema, installationIdSchema } from '@sciforge/collaboration-contracts'

import {
  loadNativeIdentityPrivateVaultBinding,
  type NativeIdentityPrivateVaultBinding
} from './private-vault/native-binding.js'

export type IdentityPrivateSecretRef =
  | Readonly<{ kind: 'oidc-session' }>
  | Readonly<{ kind: 'device-key' }>
  | Readonly<{ kind: 'agent-credential'; agentId: string }>

export interface IdentityPrivateVault {
  read(ref: IdentityPrivateSecretRef): Promise<string | null>
  write(ref: IdentityPrivateSecretRef, value: string): Promise<void>
  has(ref: IdentityPrivateSecretRef): Promise<boolean>
  remove(ref: IdentityPrivateSecretRef): Promise<void>
}

export type IdentityPrivateVaultErrorCode =
  | 'native_vault_unavailable'
  | 'secure_storage_unavailable'

export class IdentityPrivateVaultError extends Error {
  constructor(
    readonly code: IdentityPrivateVaultErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message.slice(0, 512), options)
    this.name = 'IdentityPrivateVaultError'
  }
}

export function createNativeIdentityPrivateVault(options: Readonly<{
  installationId: string
  binding?: NativeIdentityPrivateVaultBinding
}>): IdentityPrivateVault {
  const installationId = installationIdSchema.parse(options.installationId)
  let binding = options.binding
  const requireBinding = (): NativeIdentityPrivateVaultBinding => {
    binding ??= loadNativeIdentityPrivateVaultBinding()
    return binding
  }
  const vault: IdentityPrivateVault = {
    read: async (ref) => requireBinding().readSecret(vaultKey(installationId, ref)),
    write: async (ref, value) => {
      if (typeof value !== 'string' || value.length < 1 || value.length > 262_144) {
        throw new IdentityPrivateVaultError(
          'secure_storage_unavailable',
          'Identity secret value is outside the supported size bounds.'
        )
      }
      requireBinding().storeSecret(vaultKey(installationId, ref), value)
    },
    has: async (ref) => requireBinding().hasSecret(vaultKey(installationId, ref)),
    remove: async (ref) => requireBinding().deleteSecret(vaultKey(installationId, ref))
  }
  return Object.freeze(vault)
}

function vaultKey(installationId: string, rawRef: IdentityPrivateSecretRef): string {
  const ref = parseRef(rawRef)
  const fields = [
    'sciforge.identity-private-vault.v1',
    installationId,
    ref.kind,
    ref.kind === 'agent-credential' ? ref.agentId : ''
  ]
  const hash = createHash('sha256')
  for (const field of fields) {
    const bytes = Buffer.from(field, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.byteLength)
    hash.update(length)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

function parseRef(ref: IdentityPrivateSecretRef): IdentityPrivateSecretRef {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    throw new TypeError('Identity private secret reference is invalid.')
  }
  if (ref.kind === 'oidc-session' || ref.kind === 'device-key') return { kind: ref.kind }
  if (ref.kind === 'agent-credential') {
    return { kind: 'agent-credential', agentId: agentIdSchema.parse(ref.agentId) }
  }
  throw new TypeError('Identity private secret reference is invalid.')
}
