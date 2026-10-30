import {
  capabilityResourceContentAccessSchema,
  type CapabilityResourceContentAccess
} from './capability-broker'

export const CAPABILITY_RESOURCE_CONTENT_SCHEME = 'sciforge-resource'

export function serializeCapabilityResourceContentAccess(access: CapabilityResourceContentAccess): string {
  return JSON.stringify(capabilityResourceContentAccessSchema.parse(access))
}

export function parseCapabilityResourceContentAccess(serialized: string): CapabilityResourceContentAccess | null {
  try {
    const parsed = capabilityResourceContentAccessSchema.safeParse(JSON.parse(serialized))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function capabilityResourceContentSourceUrl(access: CapabilityResourceContentAccess): string {
  const url = new URL(`${CAPABILITY_RESOURCE_CONTENT_SCHEME}://content`)
  url.searchParams.set('access', serializeCapabilityResourceContentAccess(access))
  return url.toString()
}

export function capabilityResourceContentAccessFromUrl(rawUrl: string): CapabilityResourceContentAccess | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${CAPABILITY_RESOURCE_CONTENT_SCHEME}:` || url.hostname !== 'content') return null
  const serialized = url.searchParams.get('access')
  if (!serialized) return null
  return parseCapabilityResourceContentAccess(serialized)
}
