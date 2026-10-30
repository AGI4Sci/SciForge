import { isIP } from 'node:net'

import {
  workspaceEgressProxyAccessSchema,
  type WorkspaceEgressProxyAccess
} from './contract.js'
import {
  normalizeLoopbackEgressHost,
  redactWorkspaceEgressText
} from './policy.js'

export const WORKSPACE_EGRESS_BASIC_USERNAME = 'sciforge-lease' as const

export type WorkspaceEgressProcessProxyEnvironment = Readonly<{
  HTTP_PROXY: string
  HTTPS_PROXY: string
  ALL_PROXY: string
  http_proxy: string
  https_proxy: string
  all_proxy: string
}>

/**
 * Builds the standard proxy environment consumed by Codex and common HTTP
 * stacks. Runtime strict parsing deliberately rejects a complete lease object:
 * callers must select only endpoint + credential, keeping workspace scope and
 * authorized session metadata in the trusted control plane.
 */
export function createWorkspaceEgressProcessProxyEnvironment(
  input: WorkspaceEgressProxyAccess
): WorkspaceEgressProcessProxyEnvironment {
  const access = workspaceEgressProxyAccessSchema.parse(input)
  const loopbackHost = normalizeLoopbackEgressHost(access.endpoint.host)
  const host = isIP(loopbackHost) === 6
    ? `[${loopbackHost}]`
    : loopbackHost
  const username = encodeURIComponent(WORKSPACE_EGRESS_BASIC_USERNAME)
  const password = encodeURIComponent(access.credential.token)
  const proxyUrl = `http://${username}:${password}@${host}:${access.endpoint.port}`
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl
  }
}

export function redactWorkspaceEgressProcessProxyEnvironment(
  environment: WorkspaceEgressProcessProxyEnvironment
): WorkspaceEgressProcessProxyEnvironment {
  return mapProxyEnvironment(
    (value) => redactWorkspaceEgressText(value),
    environment
  )
}

function mapProxyEnvironment(
  mapValue: (value: string) => string,
  environment?: WorkspaceEgressProcessProxyEnvironment
): WorkspaceEgressProcessProxyEnvironment {
  const source = environment ?? {
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: ''
  }
  return {
    HTTP_PROXY: mapValue(source.HTTP_PROXY),
    HTTPS_PROXY: mapValue(source.HTTPS_PROXY),
    ALL_PROXY: mapValue(source.ALL_PROXY),
    http_proxy: mapValue(source.http_proxy),
    https_proxy: mapValue(source.https_proxy),
    all_proxy: mapValue(source.all_proxy)
  }
}
