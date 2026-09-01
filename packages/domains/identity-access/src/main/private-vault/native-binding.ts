import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { IdentityPrivateVaultError } from '../private-vault.js'

export type NativeIdentityPrivateVaultBinding = Readonly<{
  isAvailable(): boolean
  storeSecret(vaultKey: string, secret: string): void
  hasSecret(vaultKey: string): boolean
  readSecret(vaultKey: string): string | null
  deleteSecret(vaultKey: string): void
}>

const nativeAddonUrl = new URL(
  './native/build/Release/identity_private_vault.node',
  import.meta.url
)

export function loadNativeIdentityPrivateVaultBinding(): NativeIdentityPrivateVaultBinding {
  if (process.platform !== 'darwin') throw unavailable()
  let candidate: unknown
  try {
    candidate = createRequire(import.meta.url)(fileURLToPath(nativeAddonUrl))
  } catch {
    throw unavailable()
  }
  if (!isBinding(candidate)) throw unavailable()
  try {
    if (!candidate.isAvailable()) throw unavailable()
  } catch (error) {
    if (error instanceof IdentityPrivateVaultError) throw error
    throw unavailable()
  }
  return candidate
}

function isBinding(value: unknown): value is NativeIdentityPrivateVaultBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.isAvailable === 'function' &&
    typeof candidate.storeSecret === 'function' &&
    typeof candidate.hasSecret === 'function' &&
    typeof candidate.readSecret === 'function' &&
    typeof candidate.deleteSecret === 'function'
}

function unavailable(): IdentityPrivateVaultError {
  return new IdentityPrivateVaultError(
    'native_vault_unavailable',
    'The native Identity private vault is unavailable.'
  )
}

