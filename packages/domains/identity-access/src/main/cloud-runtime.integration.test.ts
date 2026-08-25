import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { deviceSchema, meResponseSchema, type Device } from '@sciforge/collaboration-contracts'
import { AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID } from '../authenticated-cloud-transport.js'
import { CloudIdentityRuntime } from './cloud-runtime.js'
import { cloudInstallationId } from './device-service.js'
import { IdentityService } from './service.js'
import type { PrincipalContextSnapshot } from '@sciforge/domain-sdk/principal'

type DeviceMode = 'active' | 'missing' | 'revoked'

describe('CloudIdentityRuntime HTTP integration', () => {
  it('removes Cloud Principal authority for missing, revoked, enrollment-error, and offline Device states', async () => {
    const signer = await createRsaSigner()
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-cloud-runtime-http-'))
    const installationSeed = 'installation-device-http-1'
    const installationId = cloudInstallationId(installationSeed)
    let deviceMode: DeviceMode = 'active'
    let enrollmentFails = false
    let deviceNetworkFails = false
    let refreshRotation = 0
    let currentRefreshToken = 'refresh-token-http-integration-before-restart'
    let refreshTokenRevoked = false
    let revocationAccepted = false
    let revokedTokenRejected = false
    const requestFacts: Array<{ path: string; bearer: boolean }> = []
    const commandPayloads: unknown[] = []
    const commandIdempotencyKeys: Array<string | undefined> = []
    let issuer = ''
    let baseUrl = ''

    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', baseUrl)
        if (url.pathname === '/realms/SciForge/.well-known/openid-configuration') {
          sendJson(response, 200, {
            issuer,
            authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
            token_endpoint: `${issuer}/protocol/openid-connect/token`,
            jwks_uri: `${issuer}/protocol/openid-connect/certs`,
            revocation_endpoint: `${issuer}/protocol/openid-connect/revoke`,
            end_session_endpoint: `${issuer}/protocol/openid-connect/logout`
          })
          return
        }
        if (url.pathname === '/realms/SciForge/protocol/openid-connect/certs') {
          sendJson(response, 200, { keys: [signer.publicJwk] })
          return
        }
        if (url.pathname === '/realms/SciForge/protocol/openid-connect/token') {
          const form = await readRequestForm(request)
          const presentedRefreshToken = form.get('refresh_token')
          if (
            form.get('grant_type') !== 'refresh_token' ||
            presentedRefreshToken !== currentRefreshToken ||
            refreshTokenRevoked
          ) {
            if (presentedRefreshToken === currentRefreshToken && refreshTokenRevoked) {
              revokedTokenRejected = true
            }
            sendJson(response, 400, { error: 'invalid_grant' })
            return
          }
          refreshRotation += 1
          currentRefreshToken = `refresh-token-http-integration-rotated-${refreshRotation}`
          const now = Math.floor(Date.now() / 1_000)
          const common = {
            iss: issuer,
            sub: 'keycloak-http-user-001',
            exp: now + 300,
            nbf: now,
            iat: now,
            auth_time: now
          }
          sendJson(response, 200, {
            access_token: await signer.sign({
              ...common,
              aud: 'sciforge-cloud-api',
              azp: 'sciforge-desktop'
            }),
            id_token: await signer.sign({
              ...common,
              aud: 'sciforge-desktop',
              name: 'HTTP Integration User'
            }),
            refresh_token: currentRefreshToken
          })
          return
        }
        if (url.pathname === '/realms/SciForge/protocol/openid-connect/revoke') {
          const form = await readRequestForm(request)
          if (
            form.get('client_id') !== 'sciforge-desktop' ||
            form.get('token_type_hint') !== 'refresh_token' ||
            form.get('token') !== currentRefreshToken
          ) {
            sendJson(response, 400, { error: 'invalid_request' })
            return
          }
          refreshTokenRevoked = true
          revocationAccepted = true
          sendJson(response, 200, null)
          return
        }

        const bearer = /^Bearer\s+\S+$/u.test(String(request.headers.authorization ?? ''))
        requestFacts.push({ path: url.pathname, bearer })
        if (url.pathname === '/v1/me') {
          sendJson(response, 200, meResponseSchema.parse({
            schemaVersion: 1,
            type: 'me',
            userId: 'usr_CloudUser000001',
            displayName: 'HTTP Integration User',
            status: 'active',
            oidcIdentityId: 'oid_CloudIdent0001',
            issuer,
            revision: 1,
            createdAt: '2026-08-18T12:00:00.000Z',
            updatedAt: '2026-08-18T12:00:00.000Z'
          }))
          return
        }
        if (url.pathname === '/v1/me/devices') {
          if (deviceNetworkFails) {
            request.socket.destroy()
            return
          }
          sendJson(response, 200, {
            devices: deviceMode === 'missing'
              ? []
              : [cloudDevice(deviceMode, installationId)]
          })
          return
        }
        if (url.pathname === '/v1/commands') {
          const command = await readRequestJson(request) as Readonly<{
            requestId: string
            limit?: number
          }>
          commandIdempotencyKeys.push(
            typeof request.headers['idempotency-key'] === 'string'
              ? request.headers['idempotency-key']
              : undefined
          )
          commandPayloads.push(command)
          sendJson(response, 200, {
            protocolVersion: '1.0',
            type: 'rest.project_page',
            requestId: command.requestId,
            limit: command.limit ?? 50,
            projects: [],
            observedAt: '2026-08-18T12:00:00.000Z'
          })
          return
        }
        if (url.pathname === '/v1/device-enrollments' && enrollmentFails) {
          sendJson(response, 503, {
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'The enrollment service is unavailable.',
              requestId: 'req_EnrollmentUnavailable0001'
            }
          })
          return
        }
        sendJson(response, 404, {
          error: { code: 'NOT_FOUND', message: 'Not found.' }
        })
      })().catch((error) => {
        sendJson(response, 500, {
          error: { code: 'PROVIDER_UNAVAILABLE', message: String(error) }
        })
      })
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server did not bind a TCP port.')
    baseUrl = `http://127.0.0.1:${address.port}`
    issuer = `${baseUrl}/realms/SciForge`

    const privateVault = memoryVault({
      'oidc-session:': JSON.stringify({
        version: 1,
        issuer,
        clientId: 'sciforge-desktop',
        refreshToken: currentRefreshToken
      })
    })
    const issueTarget = vi.fn((_input: { url: string; expiresAt: string }) => ({
      handle: 'external-target-unused'
    }))
    const openTarget = vi.fn(async () => undefined)
    const externalNavigation = { issueTarget, openTarget } as never
    const principal = new IdentityService(userDataDir, installationSeed)
    const principalSnapshots: PrincipalContextSnapshot[] = []
    const disposePrincipal = principal.subscribe((snapshot) => principalSnapshots.push(snapshot))
    const runtime = await CloudIdentityRuntime.create({
      userDataDir,
      appRoot: userDataDir,
      environment: {
        SCIFORGE_OIDC_ISSUER: issuer,
        SCIFORGE_CLOUD_BASE_URL: baseUrl
      },
      installationId: installationSeed,
      privateVault,
      externalNavigation,
      appVersion: '0.2.17'
    })

    try {
      await expect(runtime.initialize()).resolves.toMatchObject({
        identity: { state: 'signed-in' },
        device: { state: 'active' }
      })
      expect(principal.current()).toMatchObject({
        authority: 'sciforge-cloud',
        subject: 'usr_CloudUser000001',
        assurance: 'cloud-authenticated',
        deviceId: 'dev_CloudDevice0001'
      })
      expect(principal.current()?.deviceId).not.toBe(installationId)
      const principalBeforeRefresh = principal.snapshot()
      const principalPublicationCount = principalSnapshots.length
      const deviceStatesDuringRefresh: string[] = []
      const disposeRuntimeRefresh = runtime.subscribe(() => {
        deviceStatesDuringRefresh.push(runtime.snapshot().device.state)
      })

      await expect(runtime.initialize()).resolves.toMatchObject({
        identity: { state: 'signed-in' },
        device: { state: 'active' }
      })
      disposeRuntimeRefresh()
      expect(refreshRotation).toBe(2)
      expect(principal.snapshot()).toEqual(principalBeforeRefresh)
      expect(principalSnapshots).toHaveLength(principalPublicationCount)
      expect(deviceStatesDuringRefresh.length).toBeGreaterThan(0)
      expect(new Set(deviceStatesDuringRefresh)).toEqual(new Set(['active']))
      await expect(runtime.executeAuthenticatedCloud({
        contractVersion: 1,
        operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
        payload: {
          protocolVersion: '1.0',
          requestId: 'req_IdentityTransport0001',
          type: 'project.transition',
          idempotencyKey: 'idem_IdentityTransport0001',
          projectId: 'prj_IdentityTransport0001',
          expectedRevision: 1,
          expectedCoordinatorAuthorityEpoch: 1,
          expectedExecutionAuthorityEpoch: 1,
          status: 'paused'
        }
      })).resolves.toEqual({
        contractVersion: 1,
        status: 200,
        body: {
          protocolVersion: '1.0',
          type: 'rest.project_page',
          requestId: 'req_IdentityTransport0001',
          limit: 50,
          projects: [],
          observedAt: '2026-08-18T12:00:00.000Z'
        }
      })
      expect(commandPayloads).toEqual([{
        protocolVersion: '1.0',
        requestId: 'req_IdentityTransport0001',
        type: 'project.transition',
        idempotencyKey: 'idem_IdentityTransport0001',
        projectId: 'prj_IdentityTransport0001',
        expectedRevision: 1,
        expectedCoordinatorAuthorityEpoch: 1,
        expectedExecutionAuthorityEpoch: 1,
        status: 'paused'
      }])
      expect(commandIdempotencyKeys).toEqual(['idem_IdentityTransport0001'])
      let principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'cloud-authenticated',
        0
      )

      deviceMode = 'revoked'
      await expect(runtime.initialize()).resolves.toMatchObject({
        identity: { state: 'signed-in' },
        device: { state: 'revoked' }
      })
      expect(refreshRotation).toBe(3)
      await expect(runtime.executeAuthenticatedCloud({
        contractVersion: 1,
        operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
        payload: {
          protocolVersion: '1.0',
          requestId: 'req_IdentityTransport0002',
          type: 'project.list',
          limit: 50
        }
      })).rejects.toMatchObject({ code: 'device_required' })
      expect(commandPayloads).toHaveLength(1)
      expect(principal.current()?.assurance).toBe('local-selection')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'local-selection',
        principalVersion
      )

      deviceMode = 'active'
      await runtime.refreshDevices()
      expect(principal.current()?.assurance).toBe('cloud-authenticated')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'cloud-authenticated',
        principalVersion
      )

      deviceMode = 'missing'
      await expect(runtime.refreshDevices()).resolves.toMatchObject({
        device: { state: 'not-enrolled' }
      })
      expect(principal.current()?.assurance).toBe('local-selection')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'local-selection',
        principalVersion
      )

      deviceMode = 'active'
      await runtime.refreshDevices()
      expect(principal.current()?.assurance).toBe('cloud-authenticated')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'cloud-authenticated',
        principalVersion
      )

      deviceMode = 'revoked'
      await expect(runtime.refreshDevices()).resolves.toMatchObject({
        device: { state: 'revoked' }
      })
      expect(principal.current()?.assurance).toBe('local-selection')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'local-selection',
        principalVersion
      )

      deviceMode = 'active'
      await runtime.refreshDevices()
      expect(principal.current()?.assurance).toBe('cloud-authenticated')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'cloud-authenticated',
        principalVersion
      )

      deviceMode = 'missing'
      enrollmentFails = true
      await expect(runtime.enrollDevice()).resolves.toMatchObject({
        device: { state: 'error' },
        error: { source: 'device' }
      })
      expect(principal.current()?.assurance).toBe('local-selection')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'local-selection',
        principalVersion
      )

      enrollmentFails = false
      deviceMode = 'active'
      await runtime.refreshDevices()
      expect(principal.current()?.assurance).toBe('cloud-authenticated')
      principalVersion = expectLatestPrincipal(
        principalSnapshots,
        'cloud-authenticated',
        principalVersion
      )

      deviceNetworkFails = true
      await expect(runtime.refreshDevices()).resolves.toMatchObject({
        device: { state: 'error' },
        error: { source: 'device' }
      })
      expect(principal.current()?.assurance).toBe('local-selection')
      expectLatestPrincipal(principalSnapshots, 'local-selection', principalVersion)
      deviceNetworkFails = false
      deviceMode = 'active'
      await runtime.refreshDevices()
      expect(principal.current()?.assurance).toBe('cloud-authenticated')

      const firstRotatedRefreshToken = currentRefreshToken
      expect(refreshRotation).toBe(3)
      expect(privateVault.value({ kind: 'oidc-session' })).toContain(firstRotatedRefreshToken)
      runtime.close()
      disposePrincipal()
      principal.close()

      const restartedPrincipal = new IdentityService(userDataDir, installationSeed)
      const restartedRuntime = await CloudIdentityRuntime.create({
        userDataDir,
        appRoot: userDataDir,
        environment: {
          SCIFORGE_OIDC_ISSUER: issuer,
          SCIFORGE_CLOUD_BASE_URL: baseUrl
        },
        installationId: installationSeed,
        privateVault,
        externalNavigation,
        appVersion: '0.2.17'
      })
      try {
        await expect(restartedRuntime.initialize()).resolves.toMatchObject({
          identity: { state: 'signed-in' },
          device: { state: 'active' }
        })
        expect(refreshRotation).toBe(4)
        expect(currentRefreshToken).not.toBe(firstRotatedRefreshToken)
        expect(privateVault.value({ kind: 'oidc-session' })).toContain(currentRefreshToken)
        expect(restartedPrincipal.current()?.assurance).toBe('cloud-authenticated')

        const revokedRefreshToken = currentRefreshToken
        await expect(restartedRuntime.logout()).resolves.toMatchObject({
          identity: { state: 'signed-out' },
          device: { state: 'signed-out' }
        })
        expect(revocationAccepted).toBe(true)
        expect(privateVault.value({ kind: 'oidc-session' })).toBeNull()
        expect(restartedPrincipal.current()?.assurance).toBe('local-selection')
        expect(issueTarget.mock.calls.some(([input]) => (
          input.url.startsWith(`${issuer}/protocol/openid-connect/logout?`) &&
          input.url.includes('client_id=sciforge-desktop')
        ))).toBe(true)

        restartedRuntime.close()
        restartedPrincipal.close()
        await privateVault.write({ kind: 'oidc-session' }, JSON.stringify({
          version: 1,
          issuer,
          clientId: 'sciforge-desktop',
          refreshToken: revokedRefreshToken
        }))

        const rejectedPrincipal = new IdentityService(userDataDir, installationSeed)
        const rejectedRuntime = await CloudIdentityRuntime.create({
          userDataDir,
          appRoot: userDataDir,
          environment: {
            SCIFORGE_OIDC_ISSUER: issuer,
            SCIFORGE_CLOUD_BASE_URL: baseUrl
          },
          installationId: installationSeed,
          privateVault,
          externalNavigation,
          appVersion: '0.2.17'
        })
        try {
          await expect(rejectedRuntime.initialize()).resolves.toMatchObject({
            identity: { state: 'signed-out' },
            device: { state: 'signed-out' },
            error: { source: 'identity', code: 'OIDC_SESSION_EXPIRED' }
          })
          expect(revokedTokenRejected).toBe(true)
          expect(privateVault.value({ kind: 'oidc-session' })).toBeNull()
          expect(rejectedPrincipal.current()?.assurance).toBe('local-selection')
        } finally {
          rejectedRuntime.close()
          rejectedPrincipal.close()
        }
      } finally {
        restartedRuntime.close()
        restartedPrincipal.close()
      }

      expect(principalSnapshots.every((snapshot, index) => (
        index === 0 || snapshot.identityVersion > principalSnapshots[index - 1]!.identityVersion
      ))).toBe(true)
      expect(requestFacts.filter(({ path }) => path.startsWith('/v1/')).every(({ bearer }) => bearer)).toBe(true)
      expect(requestFacts.map(({ path }) => path)).toContain('/v1/me/devices')
    } finally {
      runtime.close()
      disposePrincipal()
      principal.close()
      if (server.listening) await closeServer(server)
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

function expectLatestPrincipal(
  snapshots: readonly PrincipalContextSnapshot[],
  assurance: 'local-selection' | 'cloud-authenticated',
  previousVersion: number
): number {
  const latest = snapshots.at(-1)
  expect(latest).toBeDefined()
  expect(latest?.principal?.assurance).toBe(assurance)
  expect(latest?.identityVersion).toBeGreaterThan(previousVersion)
  return latest!.identityVersion
}

function memoryVault(initial: Readonly<Record<string, string>>) {
  const values = new Map(Object.entries(initial))
  const key = (ref: Readonly<{ kind: string; agentId?: string }>) =>
    `${ref.kind}:${ref.agentId ?? ''}`
  return {
    has: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>) => values.has(key(ref))),
    read: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>) => values.get(key(ref)) ?? null),
    write: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>, value: string) => {
      values.set(key(ref), value)
    }),
    remove: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>) => {
      values.delete(key(ref))
    }),
    value: (ref: Readonly<{ kind: string; agentId?: string }>) => values.get(key(ref)) ?? null
  }
}

function cloudDevice(status: 'active' | 'revoked', installationId: string): Device {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })
  return deviceSchema.parse({
    schemaVersion: 1,
    type: 'device',
    deviceId: 'dev_CloudDevice0001',
    userId: 'usr_CloudUser000001',
    installationId,
    displayName: 'HTTP Integration Desktop',
    platform: { os: 'linux', arch: 'x64', appVersion: '0.2.17', osVersion: 'test' },
    publicKeyJwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      alg: 'EdDSA',
      use: 'sig',
      kid: 'device-http-integration-key',
      x: publicKey.x
    },
    capabilitySummary: ['agent.execute'],
    status,
    revision: status === 'active' ? 1 : 2,
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: status === 'active'
      ? '2026-08-18T12:00:00.000Z'
      : '2026-08-18T12:01:00.000Z',
    ...(status === 'revoked' ? { revokedAt: '2026-08-18T12:01:00.000Z' } : {})
  })
}

async function createRsaSigner() {
  const pair = await webcrypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  }, true, ['sign', 'verify'])
  const exported = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
  const publicJwk = { ...exported, kid: 'http-integration-rsa-key', use: 'sig', alg: 'RS256' }
  return {
    publicJwk,
    async sign(claims: Record<string, unknown>): Promise<string> {
      const header = encode({ alg: 'RS256', kid: publicJwk.kid, typ: 'JWT' })
      const payload = encode(claims)
      const signature = await webcrypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        pair.privateKey,
        Buffer.from(`${header}.${payload}`)
      )
      return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`
    }
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }).end(JSON.stringify(body))
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

async function readRequestForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
