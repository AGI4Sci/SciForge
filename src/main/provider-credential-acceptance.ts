import { createHash } from 'node:crypto'
import { app } from 'electron'

import { DomainMainProviderCredentialError } from '@sciforge/domain-sdk/package-storage'

import type { DomainPackageStorageFactory } from './domain-package-storage'

const ACCEPTANCE_OWNER = Object.freeze({
  moduleId: 'sciforge.provider-credential-acceptance',
  moduleVersion: '1.0.0'
})
const ACCEPTANCE_ACCESS = Object.freeze({
  binding: Object.freeze({
    providerInstanceRef: 'provider-credential-acceptance',
    connectionId: 'provider-credential-acceptance-connection'
  }),
  acceptedPrincipalAssurances: Object.freeze(['local-selection'] as const)
})

export type ProviderCredentialAcceptancePhase =
  | 'store'
  | 'rotate'
  | 'delete'
  | 'restart-absent'

export type ProviderCredentialAcceptanceResult = Readonly<{
  phase: ProviderCredentialAcceptancePhase
  platform: NodeJS.Platform
  packaged: boolean
  verified: true
}>

type ProviderCredentialAcceptanceDriver = (
  phase: ProviderCredentialAcceptancePhase
) => Promise<ProviderCredentialAcceptanceResult>

declare global {
  /** Main-process-only Playwright acceptance seam, installed only for the explicit smoke launch. */
  var __SCIFORGE_PROVIDER_CREDENTIAL_ACCEPTANCE__:
    | ProviderCredentialAcceptanceDriver
    | undefined
}

export function installProviderCredentialAcceptance(
  storageFactory: DomainPackageStorageFactory
): void {
  if (process.env.SCIFORGE_PROVIDER_CREDENTIAL_ACCEPTANCE !== '1') return
  const credentials = storageFactory.forOwner(ACCEPTANCE_OWNER).secrets.providerCredentials
  if (!credentials) throw new Error('Provider credential acceptance requires the canonical Host facade.')

  globalThis.__SCIFORGE_PROVIDER_CREDENTIAL_ACCEPTANCE__ = async (phase) => {
    const first = acceptanceSecret('first')
    const second = acceptanceSecret('second')
    if (phase === 'store') {
      assertState(await credentials.status(ACCEPTANCE_ACCESS), 'absent', phase)
      await credentials.replace(ACCEPTANCE_ACCESS, first)
      await assertSecret(credentials, first, phase)
    } else if (phase === 'rotate') {
      assertState(await credentials.status(ACCEPTANCE_ACCESS), 'available', phase)
      await assertSecret(credentials, first, phase)
      await credentials.replace(ACCEPTANCE_ACCESS, second)
      await assertSecret(credentials, second, phase)
    } else if (phase === 'delete') {
      assertState(await credentials.status(ACCEPTANCE_ACCESS), 'available', phase)
      await assertSecret(credentials, second, phase)
      await credentials.remove(ACCEPTANCE_ACCESS)
      assertState(await credentials.status(ACCEPTANCE_ACCESS), 'absent', phase)
    } else if (phase === 'restart-absent') {
      assertState(await credentials.status(ACCEPTANCE_ACCESS), 'absent', phase)
      try {
        await credentials.use(ACCEPTANCE_ACCESS, () => true)
        throw new Error('Deleted provider credential unexpectedly remained usable after restart.')
      } catch (error) {
        if (!(error instanceof DomainMainProviderCredentialError) ||
          error.code !== 'credential_unavailable') {
          throw error
        }
      }
    } else {
      throw new TypeError('Provider credential acceptance phase is invalid.')
    }
    return Object.freeze({
      phase,
      platform: process.platform,
      packaged: app.isPackaged,
      verified: true as const
    })
  }
}

function acceptanceSecret(label: 'first' | 'second'): string {
  return createHash('sha256')
    .update('sciforge-provider-credential-acceptance\u0000')
    .update(app.getPath('userData'))
    .update('\u0000')
    .update(label)
    .digest('base64url')
}

async function assertSecret(
  credentials: NonNullable<ReturnType<DomainPackageStorageFactory['forOwner']>['secrets']['providerCredentials']>,
  expected: string,
  phase: ProviderCredentialAcceptancePhase
): Promise<void> {
  const expectedDigest = createHash('sha256').update(expected).digest('hex')
  const actualDigest = await credentials.use(
    ACCEPTANCE_ACCESS,
    (secret) => createHash('sha256').update(secret).digest('hex')
  )
  if (actualDigest !== expectedDigest) {
    throw new Error(`Provider credential acceptance ${phase} read the wrong committed value.`)
  }
}

function assertState(
  status: Readonly<{ state: 'absent' | 'available' }>,
  expected: 'absent' | 'available',
  phase: ProviderCredentialAcceptancePhase
): void {
  if (status.state !== expected) {
    throw new Error(
      `Provider credential acceptance ${phase} expected ${expected}, received ${status.state}.`
    )
  }
}
