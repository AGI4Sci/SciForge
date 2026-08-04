import assert from 'node:assert/strict'
import test from 'node:test'

import type { WorkspaceEgressLease } from './contract.js'
import {
  REDACTED_WORKSPACE_EGRESS_SECRET,
  assertLoopbackEgressHost,
  isDestinationAllowed,
  isLoopbackEgressHost,
  redactEndpoint,
  redactWorkspaceEgressText,
  summarizeWorkspaceEgressLease
} from './policy.js'

test('permits only literal loopback relay bindings', () => {
  assert.equal(isLoopbackEgressHost('127.0.0.1'), true)
  assert.equal(isLoopbackEgressHost('127.24.0.9'), true)
  assert.equal(isLoopbackEgressHost('[::1]'), true)
  assert.equal(isLoopbackEgressHost('localhost'), false)
  assert.equal(isLoopbackEgressHost('0.0.0.0'), false)
  assert.equal(isLoopbackEgressHost('10.0.0.8'), false)
  assert.equal(isLoopbackEgressHost('::'), false)
  assert.throws(() => assertLoopbackEgressHost('0.0.0.0'), /loopback/)
})

test('enforces exact canonical host rules together with ports', () => {
  const allowlist = [
    { host: 'api.provider.test', ports: [443] },
    { host: 'mirror.datasets.test', ports: [443, 8443] }
  ]

  assert.equal(isDestinationAllowed(
    { hostname: 'api.provider.test', port: 443 },
    allowlist
  ), true)
  assert.equal(isDestinationAllowed(
    { hostname: 'API.PROVIDER.TEST.', port: 80 },
    allowlist
  ), false)
  assert.equal(isDestinationAllowed(
    { hostname: 'mirror.datasets.test', port: 8443 },
    allowlist
  ), true)
  assert.equal(isDestinationAllowed(
    { hostname: 'datasets.test', port: 8443 },
    allowlist
  ), false)
  assert.equal(isDestinationAllowed(
    { hostname: 'other.datasets.test', port: 8443 },
    allowlist
  ), false)
  assert.equal(isDestinationAllowed(
    { hostname: 'datasets.test.attacker.invalid', port: 443 },
    allowlist
  ), false)
})

test('redacts relay endpoints and secret-bearing text for diagnostics', () => {
  assert.equal(
    redactEndpoint('https://alice:password@cpu-egress.internal:7443/tunnel?token=raw'),
    'https://<redacted-endpoint>'
  )
  const redacted = redactWorkspaceEgressText(
    'Proxy-Authorization: Bearer lease-secret\nhttps://user:password@relay.test/p?token=raw',
    ['lease-secret']
  )
  assert.doesNotMatch(redacted, /lease-secret|password|token=raw|relay\.test/)
  assert.match(redacted, /\[redacted\]/)

  const lease: WorkspaceEgressLease = {
    protocol: 'sciforge.workspace-egress.v1',
    leaseId: 'lease-1',
    workspaceId: 'gpu-workspace',
    selection: {
      mode: 'local',
      allowlist: {
        rules: [{ host: 'api.provider.test', ports: [443] }]
      }
    },
    endpoint: {
      protocol: 'http-connect',
      host: '127.0.0.1',
      port: 43123
    },
    credential: {
      scheme: 'bearer',
      token: 'a'.repeat(40)
    },
    issuedAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2026-07-30T00:01:00.000Z'
  }
  const summary = summarizeWorkspaceEgressLease(lease)
  assert.equal(summary.credential, REDACTED_WORKSPACE_EGRESS_SECRET)
  assert.equal(summary.endpoint, 'http-connect://<redacted-endpoint>')
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(lease.credential.token))
})
