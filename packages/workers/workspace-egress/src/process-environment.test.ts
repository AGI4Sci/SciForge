import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WORKSPACE_EGRESS_BASIC_USERNAME,
  createWorkspaceEgressProcessProxyEnvironment,
  redactWorkspaceEgressProcessProxyEnvironment
} from './process-environment.js'

const endpoint = {
  protocol: 'http-connect' as const,
  host: '127.0.0.1',
  port: 43123
}

const credential = {
  scheme: 'bearer' as const,
  token: 'lease-token-with-more-than-thirty-two-characters'
}

test('builds standard proxy variables from endpoint and credential only', () => {
  const environment = createWorkspaceEgressProcessProxyEnvironment({
    endpoint,
    credential
  })
  const proxyUrl = new URL(environment.HTTPS_PROXY)

  assert.equal(proxyUrl.protocol, 'http:')
  assert.equal(proxyUrl.hostname, '127.0.0.1')
  assert.equal(proxyUrl.port, '43123')
  assert.equal(decodeURIComponent(proxyUrl.username), WORKSPACE_EGRESS_BASIC_USERNAME)
  assert.equal(decodeURIComponent(proxyUrl.password), credential.token)
  assert.equal(environment.HTTP_PROXY, environment.HTTPS_PROXY)
  assert.equal(environment.ALL_PROXY, environment.HTTPS_PROXY)
  assert.equal(environment.http_proxy, environment.HTTPS_PROXY)
  assert.equal(environment.https_proxy, environment.HTTPS_PROXY)
  assert.equal(environment.all_proxy, environment.HTTPS_PROXY)
})

test('strictly rejects forwarding a complete lease with its selection metadata', () => {
  assert.throws(() => createWorkspaceEgressProcessProxyEnvironment({
    endpoint,
    credential,
    protocol: 'sciforge.workspace-egress.v1',
    leaseId: 'lease-1',
    workspaceId: 'gpu-workspace',
    selection: {
      mode: 'remote-target',
      authorizedSessionId: 'must-stay-local',
      allowlist: {
        rules: [{ host: 'api.provider.test', ports: [443] }]
      }
    },
    issuedAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2026-07-30T00:01:00.000Z'
  }))
})

test('redacts every proxy URL without leaking the token or endpoint', () => {
  const environment = createWorkspaceEgressProcessProxyEnvironment({
    endpoint,
    credential
  })
  const redacted = redactWorkspaceEgressProcessProxyEnvironment(environment)
  for (const value of Object.values(redacted)) {
    assert.equal(value, 'http://<redacted-endpoint>')
    assert.doesNotMatch(value, /lease-token|127\.0\.0\.1|43123/)
  }
})

test('formats an IPv6 loopback proxy URL with brackets', () => {
  const environment = createWorkspaceEgressProcessProxyEnvironment({
    endpoint: {
      protocol: 'http-connect',
      host: '::1',
      port: 43123
    },
    credential
  })
  assert.match(environment.HTTPS_PROXY, /@\[::1\]:43123$/)
})

test('refuses to inject a non-loopback proxy endpoint', () => {
  assert.throws(() => createWorkspaceEgressProcessProxyEnvironment({
    endpoint: {
      protocol: 'http-connect',
      host: '10.20.30.40',
      port: 43123
    },
    credential
  }), /loopback/)
})
