import { z } from 'zod'
import type {
  DomainMainPackageSettingsHost,
  DomainMainPackageSettingsSnapshot
} from '@sciforge/domain-sdk/package-storage'
import { validateIdentityUrl } from './cloud-runtime-config.js'

/**
 * Non-secret, package-owned Cloud deployment configuration.
 *
 * The values are the deployment-provided OIDC issuer and Cloud API origin.
 * Token material never enters this document; Desktop sessions stay in the
 * Identity private vault.
 */
const identityCloudSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  oidcIssuer: z.string().min(1).max(2_048).optional(),
  cloudBaseUrl: z.string().min(1).max(2_048).optional()
}).strict()

export type IdentityCloudSettings = z.infer<typeof identityCloudSettingsSchema>

export type IdentityCloudSettingsInput = Readonly<{
  oidcIssuer: string | null
  cloudBaseUrl: string | null
}>

export class IdentityCloudSettingsService {
  constructor(private readonly host: DomainMainPackageSettingsHost) {}

  async read(): Promise<Readonly<{
    revision: number
    settings: IdentityCloudSettings | null
  }>> {
    const snapshot = await this.host.read()
    return {
      revision: snapshot.revision,
      settings: snapshot.value === null
        ? null
        : identityCloudSettingsSchema.parse(snapshot.value)
    }
  }

  async configure(
    input: IdentityCloudSettingsInput
  ): Promise<Readonly<{ revision: number; settings: IdentityCloudSettings }>> {
    const oidcIssuer = normalizeIdentityCloudUrl(input.oidcIssuer, 'the OIDC issuer')
    const cloudBaseUrl = normalizeIdentityCloudUrl(
      input.cloudBaseUrl,
      'the SciForge Cloud service address'
    )
    const value = identityCloudSettingsSchema.parse({
      schemaVersion: 1,
      ...(oidcIssuer === undefined ? {} : { oidcIssuer }),
      ...(cloudBaseUrl === undefined ? {} : { cloudBaseUrl })
    })
    let snapshot: DomainMainPackageSettingsSnapshot = await this.host.read()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const written = await this.host.write(value, snapshot.revision)
        return {
          revision: written.revision,
          settings: identityCloudSettingsSchema.parse(written.value)
        }
      } catch (error) {
        if (attempt > 0) throw error
        snapshot = await this.host.read()
      }
    }
    throw new Error('Unable to update SciForge Cloud settings.')
  }
}

function normalizeIdentityCloudUrl(value: string | null, label: string): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  validateIdentityUrl(trimmed, label)
  return trimmed
}
