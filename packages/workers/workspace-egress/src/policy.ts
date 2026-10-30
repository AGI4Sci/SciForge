import { isIP } from 'node:net'
import type {
  WorkspaceNetworkEgressAllowlistRule
} from '@sciforge/domain-sdk/workspace-host'

import type {
  WorkspaceEgressDestination,
  WorkspaceEgressLease,
  WorkspaceEgressRelayEndpoint
} from './contract.js'

export const REDACTED_WORKSPACE_EGRESS_SECRET = '[redacted]' as const

export function isLoopbackEgressHost(host: string): boolean {
  const normalized = normalizeHost(host)
  const addressFamily = isIP(normalized)
  if (addressFamily === 4) {
    return normalized.startsWith('127.')
  }
  return addressFamily === 6 && normalized === '::1'
}

export function assertLoopbackEgressHost(host: string): void {
  if (!isLoopbackEgressHost(host)) {
    throw new Error(`Workspace egress relay can bind only to a loopback IP address: ${redactEndpoint(host)}`)
  }
}

export function normalizeLoopbackEgressHost(host: string): string {
  assertLoopbackEgressHost(host)
  return normalizeHost(host)
}

export function isDestinationAllowed(
  destination: WorkspaceEgressDestination,
  allowlist: readonly WorkspaceNetworkEgressAllowlistRule[]
): boolean {
  const hostname = normalizeDestinationHost(destination.hostname)
  return allowlist.some((rule) =>
    rule.ports.includes(destination.port) &&
    hostname === normalizeDestinationHost(rule.host)
  )
}

export function redactEndpoint(endpoint: string | WorkspaceEgressRelayEndpoint): string {
  if (typeof endpoint !== 'string') {
    return `${endpoint.protocol}://<redacted-endpoint>`
  }

  const value = endpoint.trim()
  if (!value) {
    return value
  }

  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`)
    const protocol = value.includes('://') ? parsed.protocol : ''
    return `${protocol}//<redacted-endpoint>`
  } catch {
    return '<redacted-endpoint>'
  }
}

export function redactWorkspaceEgressText(
  value: string,
  secrets: readonly string[] = []
): string {
  let redacted = value
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join(REDACTED_WORKSPACE_EGRESS_SECRET)
    }
  }

  redacted = redacted
    .replace(
      /\b(Proxy-Authorization|Authorization|X-SciForge-Egress-Token)\s*:\s*[^\r\n]+/gi,
      `$1: ${REDACTED_WORKSPACE_EGRESS_SECRET}`
    )
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      `$1 ${REDACTED_WORKSPACE_EGRESS_SECRET}`
    )
    .replace(
      /([?&](?:access_?token|api_?key|auth|authorization|credential|secret|token)=)[^&#\s]+/gi,
      `$1${REDACTED_WORKSPACE_EGRESS_SECRET}`
    )
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi,
      `$1${REDACTED_WORKSPACE_EGRESS_SECRET}@`
    )
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s]+/gi,
      `$1<redacted-endpoint>`
    )

  return redacted
}

export function summarizeWorkspaceEgressLease(
  lease: WorkspaceEgressLease
): Omit<WorkspaceEgressLease, 'credential' | 'endpoint'> & {
  credential: typeof REDACTED_WORKSPACE_EGRESS_SECRET
  endpoint: string
} {
  return {
    ...lease,
    endpoint: redactEndpoint(lease.endpoint),
    credential: REDACTED_WORKSPACE_EGRESS_SECRET
  }
}

export function normalizeDestinationHost(host: string): string {
  const normalized = normalizeHost(host).replace(/\.$/, '')
  if (
    !normalized ||
    normalized.includes('/') ||
    normalized.includes('@') ||
    normalized.includes('%') ||
    /\s/.test(normalized)
  ) {
    throw new Error('Invalid CONNECT destination hostname.')
  }
  return normalized
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '')
}
