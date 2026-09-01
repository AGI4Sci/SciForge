import { z } from 'zod'
import type {
  DomainMainPackageSettingsHost,
  DomainMainPackageSettingsSnapshot
} from '@sciforge/domain-sdk/package-storage'

const collaborationSettingsSchema = z.object({
  schemaVersion: z.literal(2),
  baseUrl: z.url().max(2_048).refine((value) => new URL(value).protocol === 'https:')
}).strict()

export type CollaborationSettings = z.infer<typeof collaborationSettingsSchema>

export class CollaborationSettingsService {
  constructor(private readonly host: DomainMainPackageSettingsHost) {}

  async read(): Promise<Readonly<{
    revision: number
    settings: CollaborationSettings | null
  }>> {
    const snapshot = await this.host.read()
    return {
      revision: snapshot.revision,
      settings: snapshot.value === null
        ? null
        : collaborationSettingsSchema.parse(snapshot.value)
    }
  }

  async configure(baseUrl: string): Promise<CollaborationSettings> {
    const normalized = normalizeCollaborationBaseUrl(baseUrl)
    return this.writeCurrent((current) => ({
      schemaVersion: 2,
      baseUrl: normalized
    }))
  }

  async require(): Promise<CollaborationSettings> {
    const current = await this.read()
    if (!current.settings) throw new Error('Collaboration service is not configured.')
    return current.settings
  }

  private async writeCurrent(
    create: (current: CollaborationSettings | null) => CollaborationSettings
  ): Promise<CollaborationSettings> {
    let snapshot: DomainMainPackageSettingsSnapshot = await this.host.read()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = snapshot.value === null
        ? null
        : collaborationSettingsSchema.parse(snapshot.value)
      const next = collaborationSettingsSchema.parse(create(current))
      try {
        const written = await this.host.write(next, snapshot.revision)
        return collaborationSettingsSchema.parse(written.value)
      } catch (error) {
        if (attempt > 0) throw error
        snapshot = await this.host.read()
      }
    }
    throw new Error('Unable to update collaboration settings.')
  }
}

export function normalizeCollaborationBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Collaboration service URL must use HTTPS.')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Collaboration service URL cannot contain credentials, query, or fragment.')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/'
  return url.toString().replace(/\/$/u, '')
}
