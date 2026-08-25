import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
  OpenContentPrivateAccountError
} from '../private-account-runtime.js'

export type NativeEnrollmentCredentials = {
  username: string
  password: string
}

/**
 * Package-private ABI exposed by the Connector-owned Node-API addon.
 *
 * These methods are deliberately synchronous: AppKit's account prompt and the
 * Security.framework generic-password calls are one bounded native operation.
 * This interface must never be exported through the Domain SDK, Electron IPC,
 * capability receipts, or the renderer.
 */
export type NativeOpenContentEnrollmentBinding = Readonly<{
  isAvailable(): boolean
  promptCredentials(): NativeEnrollmentCredentials | null
  storeSecret(vaultKey: string, secret: string): void
  hasSecret(vaultKey: string): boolean
  readSecret(vaultKey: string): string | null
  deleteSecret(vaultKey: string): void
}>

const nativeAddonUrl = new URL(
  './native/build/Release/opencontent_native_enrollment.node',
  import.meta.url
)

export function loadNativeOpenContentEnrollmentBinding():
NativeOpenContentEnrollmentBinding {
  if (process.platform !== 'darwin') throw nativeEnrollmentUnavailable()

  let candidate: unknown
  try {
    const require = createRequire(import.meta.url)
    candidate = require(fileURLToPath(nativeAddonUrl))
  } catch {
    throw nativeEnrollmentUnavailable()
  }
  if (!isNativeOpenContentEnrollmentBinding(candidate)) {
    throw nativeEnrollmentUnavailable()
  }
  try {
    if (!candidate.isAvailable()) throw nativeEnrollmentUnavailable()
  } catch (error) {
    if (error instanceof OpenContentPrivateAccountError) throw error
    throw nativeEnrollmentUnavailable()
  }
  return candidate
}

function isNativeOpenContentEnrollmentBinding(
  value: unknown
): value is NativeOpenContentEnrollmentBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.isAvailable === 'function' &&
    typeof candidate.promptCredentials === 'function' &&
    typeof candidate.storeSecret === 'function' &&
    typeof candidate.hasSecret === 'function' &&
    typeof candidate.readSecret === 'function' &&
    typeof candidate.deleteSecret === 'function'
}

function nativeEnrollmentUnavailable(): OpenContentPrivateAccountError {
  return new OpenContentPrivateAccountError(
    'native_enrollment_unavailable',
    'Native OpenContent account enrollment is unavailable.'
  )
}
