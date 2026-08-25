import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  AuthenticatedCloudTransportError,
  type AuthenticatedCloudRequest,
  type AuthenticatedCloudResponse,
  type AuthenticatedCloudTransportStatus
} from '../authenticated-cloud-transport.js'
import type { DomainMainExternalNavigationHost } from '@sciforge/domain-sdk/host'
import type {
  CloudIdentitySnapshot,
  DesktopDeviceActionResult,
  DesktopDeviceStatus,
  DesktopIdentityActionResult,
  DesktopIdentityStatus
} from '../contract.js'
import { LocalCloudIdentityLinkService } from './cloud-link-service.js'
import {
  createUnavailableCloudIdentityClient,
  resolveDesktopIdentityRuntimeConfig
} from './cloud-runtime-config.js'
import { HttpCloudIdentityClient } from './cloud-identity-client.js'
import { DesktopDeviceService } from './device-service.js'
import { DesktopIdentityService } from './oidc-service.js'
import { PrivateVaultDesktopIdentitySessionStore } from './session-store.js'
import type { IdentityPrivateVault } from './private-vault.js'
import type {
  DeviceFactSignatureMetadata,
  DeviceFactSigningRequest
} from '@sciforge/collaboration-contracts'
import { restResponseSchema } from '@sciforge/collaboration-contracts'

type CloudIdentityRuntimeError = NonNullable<CloudIdentitySnapshot['error']>

type CloudIdentityLinks = Pick<
  LocalCloudIdentityLinkService,
  'linkIdentity' | 'linkDevice' | 'clearActiveDevice' | 'setAuthenticatedCloudUser' | 'close'
>

export type CloudIdentityRuntimeOptions = Readonly<{
  userDataDir: string
  appRoot: string
  environment: Readonly<Record<string, string | undefined>>
  installationId: string
  privateVault: IdentityPrivateVault
  externalNavigation?: DomainMainExternalNavigationHost
  appVersion?: string
  fetchImpl?: typeof fetch
}>

export class CloudIdentityRuntime {
  readonly #identity: DesktopIdentityService
  readonly #device: DesktopDeviceService
  readonly #links: CloudIdentityLinks
  readonly #listeners = new Set<() => void>()
  readonly #disposeIdentitySubscription: () => void
  readonly #disposeDeviceSubscription: () => void
  readonly #cloudBaseUrl: string | null
  readonly #transportUnavailableReason: string | null
  readonly #fetch: typeof fetch
  #revision = 1
  #identityError: CloudIdentityRuntimeError | undefined
  #deviceError: CloudIdentityRuntimeError | undefined
  #runtimeError: CloudIdentityRuntimeError | undefined
  #closed = false

  private constructor(input: Readonly<{
    identity: DesktopIdentityService
    device: DesktopDeviceService
    links: CloudIdentityLinks
    cloudBaseUrl: string | null
    transportUnavailableReason: string | null
    fetchImpl: typeof fetch
    runtimeError?: CloudIdentityRuntimeError
  }>) {
    this.#identity = input.identity
    this.#device = input.device
    this.#links = input.links
    this.#cloudBaseUrl = input.cloudBaseUrl
    this.#transportUnavailableReason = input.transportUnavailableReason
    this.#fetch = input.fetchImpl
    this.#runtimeError = input.runtimeError
    this.#disposeIdentitySubscription = this.#identity.subscribe((status) => {
      this.#projectAuthenticatedUser(status)
      this.#publish()
    })
    this.#disposeDeviceSubscription = this.#device.subscribe((status) => {
      if (status.state !== 'active') this.#clearActiveDeviceAuthority()
      this.#publish()
    })
    this.#projectAuthenticatedUser(this.#identity.getStatus())
  }

  static async create(options: CloudIdentityRuntimeOptions): Promise<CloudIdentityRuntime> {
    const identityConfig = resolveDesktopIdentityRuntimeConfig({
      oidcIssuer: options.environment.SCIFORGE_OIDC_ISSUER,
      cloudBaseUrl: options.environment.SCIFORGE_CLOUD_BASE_URL
    })
    const cloudBaseUrl = identityConfig.mode === 'http'
      ? identityConfig.cloudBaseUrl.replace(/\/+$/u, '')
      : null
    const identityClient = identityConfig.mode === 'http'
      ? new HttpCloudIdentityClient({
          baseUrl: cloudBaseUrl!,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
        })
      : createUnavailableCloudIdentityClient(identityConfig.error)
    const appVersion = options.appVersion ?? await readApplicationVersion(options.appRoot)
    const linkResult = createCloudIdentityLinks(options.userDataDir)
    const links = linkResult.links
    const navigationError = options.externalNavigation
      ? undefined
      : 'Cloud identity requires the Host external-navigation service.'
    const configurationError = [
      identityConfig.mode === 'disabled' ? identityConfig.error : undefined,
      navigationError
    ].filter((value): value is string => Boolean(value)).join(' ')
    const openExternal = async (url: string): Promise<void> => {
      if (!options.externalNavigation) throw new Error(navigationError)
      const target = options.externalNavigation.issueTarget({
        url,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })
      await options.externalNavigation.openTarget({ handle: target.handle })
    }
    let identity: DesktopIdentityService | undefined
    let device: DesktopDeviceService | undefined
    try {
      identity = new DesktopIdentityService({
        issuer: identityConfig.issuer,
        clientId: 'sciforge-desktop',
        audience: 'sciforge-cloud-api',
        identityClient,
        sessionStore: new PrivateVaultDesktopIdentitySessionStore(options.privateVault),
        linkAuthenticatedUser: (user) => {
          links.linkIdentity({
            cloudUserId: user.userId,
            oidcIdentityId: user.oidcIdentityId,
            issuer: user.issuer,
            subject: user.subject,
            displayName: user.displayName
          })
        },
        ...(configurationError ? { configurationError } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        openExternal
      })
      device = new DesktopDeviceService({
        identity,
        client: identityClient,
        installationSeed: options.installationId,
        vault: options.privateVault,
        appVersion,
        linkDevice: (cloudDevice) => {
          links.linkDevice(cloudDevice.userId, cloudDevice.deviceId, cloudDevice.status)
        }
      })
      return new CloudIdentityRuntime({
        identity,
        device,
        links,
        cloudBaseUrl,
        transportUnavailableReason: configurationError || null,
        fetchImpl: options.fetchImpl ?? fetch,
        ...(linkResult.error ? { runtimeError: linkResult.error } : {})
      })
    } catch (error) {
      const cleanupErrors: unknown[] = []
      for (const close of [
        () => device?.close(),
        () => identity?.close(),
        () => links.close()
      ]) {
        try {
          close()
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Cloud identity construction failed and cleanup did not complete.'
        )
      }
      throw error
    }
  }

  async initialize(): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    try {
      const identity = await this.#identity.initialize()
      this.#acceptIdentityResult(identity)
      if (identity.ok && identity.status.state === 'signed-in') {
        this.#acceptDeviceResult(await this.#device.ensureRegistered())
      }
    } catch (error) {
      this.#runtimeError = {
        source: 'runtime',
        message: error instanceof Error
          ? error.message
          : 'Cloud identity initialization failed.'
      }
      this.#publish()
    }
    return this.snapshot()
  }

  snapshot(): CloudIdentitySnapshot {
    this.#assertOpen()
    const error = this.#runtimeError ?? this.#identityError ?? this.#deviceError
    return Object.freeze({
      identity: this.#identity.getStatus(),
      device: this.#device.getStatus(),
      devices: [...this.#device.listDevices()],
      revision: this.semanticRevision(),
      ...(error ? { error } : {})
    })
  }

  semanticRevision(): string {
    return `cloud-${this.#revision}`
  }

  subscribe(listener: () => void): () => void {
    this.#assertOpen()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async login(): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    const result = await this.#identity.login()
    this.#acceptIdentityResult(result)
    if (result.ok && result.status.state === 'signed-in') {
      this.#acceptDeviceResult(await this.#device.ensureRegistered())
    }
    return this.snapshot()
  }

  async reauthenticate(): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    const result = await this.#identity.reauthenticate()
    this.#acceptIdentityResult(result)
    if (result.ok && result.status.state === 'signed-in') {
      this.#acceptDeviceResult(await this.#device.ensureRegistered())
    }
    return this.snapshot()
  }

  async logout(): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    this.#acceptIdentityResult(await this.#identity.logout())
    return this.snapshot()
  }

  async enrollDevice(): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    this.#acceptDeviceResult(await this.#device.ensureRegistered())
    return this.snapshot()
  }

  async refreshDevices(): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    this.#acceptDeviceResult(await this.#device.refresh())
    return this.snapshot()
  }

  async revokeDevice(deviceId: string): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    this.#acceptDeviceResult(await this.#device.revoke(deviceId))
    return this.snapshot()
  }

  async signDeviceFactAttestation(
    request: DeviceFactSigningRequest
  ): Promise<DeviceFactSignatureMetadata> {
    this.#assertOpen()
    return this.#device.signDeviceFactAttestation(request)
  }

  authenticatedCloudTransportStatus(): AuthenticatedCloudTransportStatus {
    this.#assertOpen()
    if (!this.#cloudBaseUrl) {
      return {
        state: 'unavailable',
        reason: this.#transportUnavailableReason ?? 'SciForge Cloud is not configured.'
      }
    }
    const identity = this.#identity.getStatus()
    if (identity.state !== 'signed-in') {
      return { state: 'identity_required', baseUrl: this.#cloudBaseUrl }
    }
    const device = this.#device.getStatus()
    if (device.state !== 'active') {
      return {
        state: 'device_required',
        baseUrl: this.#cloudBaseUrl,
        reason: device.state === 'revoked'
          ? 'This Desktop Device has been revoked.'
          : 'Register this Desktop Device before continuing.'
      }
    }
    return {
      state: 'ready',
      baseUrl: this.#cloudBaseUrl,
      userId: identity.user.userId,
      deviceId: device.device.deviceId
    }
  }

  async executeAuthenticatedCloud(
    request: AuthenticatedCloudRequest,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<AuthenticatedCloudResponse> {
    this.#assertOpen()
    if (!this.#cloudBaseUrl) {
      throw new AuthenticatedCloudTransportError(
        'transport_unavailable',
        this.#transportUnavailableReason ?? 'SciForge Cloud is not configured.'
      )
    }
    if (request.operationId !== AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID) {
      throw new AuthenticatedCloudTransportError(
        'operation_not_allowed',
        'The requested authenticated Cloud operation is not registered.'
      )
    }
    if (this.#identity.getStatus().state !== 'signed-in') {
      throw new AuthenticatedCloudTransportError(
        'identity_required',
        'Sign in to SciForge Cloud before continuing.'
      )
    }

    const refreshedDevice = await this.#device.refresh()
    this.#acceptDeviceResult(refreshedDevice)
    if (!refreshedDevice.ok || refreshedDevice.status.state !== 'active') {
      throw new AuthenticatedCloudTransportError(
        refreshedDevice.status.state === 'error' ? 'cloud_unavailable' : 'device_required',
        refreshedDevice.status.state === 'revoked'
          ? 'This Desktop Device has been revoked.'
          : refreshedDevice.status.state === 'not-enrolled'
            ? 'Register this Desktop Device before continuing.'
            : 'SciForge Cloud could not verify this Desktop Device.'
      )
    }

    let response: Response
    try {
      response = await this.#identity.useAccessToken((accessToken) => this.#fetch(
        `${this.#cloudBaseUrl}/v1/commands`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: 'application/json',
            'content-type': 'application/json',
            ...authenticatedCloudIdempotencyHeader(request.payload)
          },
          body: JSON.stringify(request.payload),
          ...(options?.signal ? { signal: options.signal } : {})
        }
      ))
    } catch (error) {
      if (error instanceof AuthenticatedCloudTransportError) throw error
      if (this.#identity.getStatus().state !== 'signed-in') {
        throw new AuthenticatedCloudTransportError(
          'identity_required',
          'Sign in to SciForge Cloud before continuing.',
          { cause: error }
        )
      }
      throw new AuthenticatedCloudTransportError(
        'cloud_unavailable',
        'SciForge Cloud is unavailable.',
        { cause: error }
      )
    }

    return {
      contractVersion: 1,
      status: response.status,
      body: await readAuthenticatedCloudBody(response)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#disposeDeviceSubscription()
    this.#disposeIdentitySubscription()
    this.#device.close()
    this.#identity.close()
    this.#links.close()
    this.#listeners.clear()
  }

  #projectAuthenticatedUser(status: DesktopIdentityStatus): void {
    try {
      this.#links.setAuthenticatedCloudUser(
        status.state === 'signed-in' ? status.user.userId : null
      )
      this.#runtimeError = undefined
    } catch (error) {
      this.#runtimeError = {
        source: 'runtime',
        message: error instanceof Error
          ? error.message
          : 'Cloud identity could not be projected into the canonical Principal.'
      }
    }
  }

  #clearActiveDeviceAuthority(): void {
    try {
      this.#links.clearActiveDevice()
    } catch (error) {
      this.#runtimeError = {
        source: 'runtime',
        message: error instanceof Error
          ? error.message
          : 'Cloud Device authority could not be cleared from the canonical Principal.'
      }
    }
  }

  #acceptIdentityResult(result: DesktopIdentityActionResult): void {
    this.#identityError = result.ok
      ? undefined
      : {
          source: 'identity',
          code: result.error.code,
          message: result.error.message
        }
    this.#publish()
  }

  #acceptDeviceResult(result: DesktopDeviceActionResult): void {
    this.#deviceError = result.ok
      ? undefined
      : { source: 'device', message: result.message }
    this.#publish()
  }

  #publish(): void {
    if (this.#closed) return
    this.#revision += 1
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // Observers cannot interrupt committed identity or Device transitions.
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Cloud identity runtime is closed.')
  }
}

function authenticatedCloudIdempotencyHeader(
  payload: AuthenticatedCloudRequest['payload']
): Readonly<Record<string, string>> {
  return 'idempotencyKey' in payload
    ? { 'idempotency-key': payload.idempotencyKey }
    : {}
}

const MAX_AUTHENTICATED_CLOUD_RESPONSE_BYTES = 1_048_576

async function readAuthenticatedCloudBody(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTHENTICATED_CLOUD_RESPONSE_BYTES) {
    throw new AuthenticatedCloudTransportError(
      'cloud_response_invalid',
      'SciForge Cloud returned a response larger than 1 MiB.'
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_AUTHENTICATED_CLOUD_RESPONSE_BYTES) {
    throw new AuthenticatedCloudTransportError(
      'cloud_response_invalid',
      'SciForge Cloud returned a response larger than 1 MiB.'
    )
  }
  if (bytes.byteLength === 0) {
    throw new AuthenticatedCloudTransportError(
      'cloud_response_invalid',
      'SciForge Cloud returned an empty command response.'
    )
  }
  try {
    return restResponseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (error) {
    throw new AuthenticatedCloudTransportError(
      'cloud_response_invalid',
      'SciForge Cloud returned an invalid JSON response.',
      { cause: error }
    )
  }
}

async function readApplicationVersion(appRoot: string): Promise<string> {
  const raw = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  const version = typeof raw.version === 'string' ? raw.version.trim() : ''
  if (!version || version.length > 256) {
    throw new Error('SciForge application metadata does not contain a valid version.')
  }
  return version
}

function createCloudIdentityLinks(userDataDir: string): Readonly<{
  links: CloudIdentityLinks
  error?: CloudIdentityRuntimeError
}> {
  try {
    return { links: new LocalCloudIdentityLinkService(userDataDir) }
  } catch (error) {
    const message = error instanceof Error
      ? `Local cloud identity storage is unavailable: ${error.message}`
      : 'Local cloud identity storage is unavailable.'
    const unavailable = (): never => {
      throw new Error(message)
    }
    return {
      links: Object.freeze({
        linkIdentity: unavailable,
        linkDevice: unavailable,
        clearActiveDevice: unavailable,
        setAuthenticatedCloudUser: unavailable,
        close: () => undefined
      }),
      error: { source: 'runtime', message }
    }
  }
}
