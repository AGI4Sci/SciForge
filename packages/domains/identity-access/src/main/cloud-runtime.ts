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
  DesktopIdentityStatus,
  DesktopIdentityUser
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
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
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
  onAuthorityInvalidated?: (reason: string) => void
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
  readonly #openExternal: (url: string) => Promise<void>
  readonly #onAuthorityInvalidated: (reason: string) => void
  #revision = 1
  #identityError: CloudIdentityRuntimeError | undefined
  #deviceError: CloudIdentityRuntimeError | undefined
  #runtimeError: CloudIdentityRuntimeError | undefined
  #closed = false
  #authorityIdentityKey: string | null
  #authorityUserId: string | null

  private constructor(input: Readonly<{
    identity: DesktopIdentityService
    device: DesktopDeviceService
    links: CloudIdentityLinks
    cloudBaseUrl: string | null
    transportUnavailableReason: string | null
    fetchImpl: typeof fetch
    openExternal: (url: string) => Promise<void>
    onAuthorityInvalidated: (reason: string) => void
    runtimeError?: CloudIdentityRuntimeError
  }>) {
    this.#identity = input.identity
    this.#device = input.device
    this.#links = input.links
    this.#cloudBaseUrl = input.cloudBaseUrl
    this.#transportUnavailableReason = input.transportUnavailableReason
    this.#fetch = input.fetchImpl
    this.#openExternal = input.openExternal
    this.#onAuthorityInvalidated = input.onAuthorityInvalidated
    this.#runtimeError = input.runtimeError
    this.#authorityIdentityKey = authorityIdentityKey(
      this.#identity.getStatus(),
      this.#device.getStatus()
    )
    this.#authorityUserId = authorityUserId(this.#identity.getStatus())
    this.#disposeIdentitySubscription = this.#identity.subscribe((status) => {
      this.#projectAuthenticatedUser(status)
      this.#invalidateChangedUserAuthority(status)
      this.#publish()
    })
    this.#disposeDeviceSubscription = this.#device.subscribe((status) => {
      if (status.state !== 'active') this.#clearActiveDeviceAuthority()
      if (authorityUserId(this.#identity.getStatus()) === this.#authorityUserId) {
        this.#invalidateChangedAuthority('Desktop Device authority changed.')
      }
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
        openExternal,
        onAuthorityInvalidated: options.onAuthorityInvalidated ?? (() => undefined),
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

  async openAccountDeletionPortal(expectedPrincipal: PrincipalSnapshot): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    const before = this.#identity.getStatus()
    if (before.state !== 'signed-in') {
      throw new Error('A signed-in SciForge Cloud identity is required to delete the account.')
    }
    if (
      expectedPrincipal.authority !== 'sciforge-cloud' ||
      expectedPrincipal.assurance !== 'cloud-authenticated'
    ) {
      throw new Error(
        'Account deletion requires the current cloud-authenticated SciForge Principal.'
      )
    }
    const activeDevice = this.#device.getStatus()
    if (activeDevice.state !== 'active') {
      throw new Error(
        'Account deletion requires an active Desktop Device for the current Cloud identity.'
      )
    }
    if (
      expectedPrincipal.subject !== before.user.userId ||
      expectedPrincipal.deviceId !== activeDevice.device.deviceId
    ) {
      throw new Error(
        'The current Cloud identity or Desktop Device no longer matches the account deletion request.'
      )
    }

    // Re-authenticate through the existing PKCE flow before opening the
    // account console, so a different browser cookie cannot select another
    // account silently.
    const reauthenticated = await this.#identity.reauthenticate()
    this.#acceptIdentityResult(reauthenticated)
    if (!reauthenticated.ok) throw new Error(reauthenticated.error.message)
    if (
      reauthenticated.status.state !== 'signed-in' ||
      !sameCloudIdentityUser(reauthenticated.status.user, before.user)
    ) {
      throw new Error('Reauthentication completed for a different SciForge user.')
    }
    const deviceAfterReauthentication = this.#device.getStatus()
    if (
      deviceAfterReauthentication.state !== 'active' ||
      deviceAfterReauthentication.device.deviceId !== expectedPrincipal.deviceId
    ) {
      throw new Error(
        'The Desktop Device changed during account deletion reauthentication.'
      )
    }

    await this.#openExternal(buildAccountConsoleUrl(reauthenticated.status.user.issuer))
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

  async revalidateCurrentDevice(): Promise<AuthenticatedCloudTransportStatus> {
    this.#assertOpen()
    if (this.#identity.getStatus().state !== 'signed-in') {
      return this.authenticatedCloudTransportStatus()
    }
    this.#acceptDeviceResult(await this.#device.refresh())
    return this.authenticatedCloudTransportStatus()
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
    if (device.state === 'error') {
      return {
        state: 'unavailable',
        reason: 'SciForge Cloud could not confirm this Desktop Device.'
      }
    }
    if (device.state !== 'active') {
      return {
        state: 'device_required',
        baseUrl: this.#cloudBaseUrl,
        reason: device.state === 'revoked'
          ? 'This Desktop Device has been revoked.'
          : 'Register this Desktop Device before continuing.'
      }
    }
    const deviceRevision = this.#device.activeDeviceRevision()
    if (deviceRevision === undefined) {
      return {
        state: 'unavailable',
        reason: 'SciForge Cloud did not retain the ACTIVE Desktop Device revision.'
      }
    }
    return {
      state: 'ready',
      baseUrl: this.#cloudBaseUrl,
      userId: identity.user.userId,
      deviceId: device.device.deviceId,
      deviceRevision
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
    const revalidated = await this.revalidateCurrentDevice()
    if (revalidated.state !== 'ready') {
      throw new AuthenticatedCloudTransportError(
        revalidated.state === 'identity_required'
          ? 'identity_required'
          : revalidated.state === 'device_required'
            ? 'device_required'
            : 'cloud_unavailable',
        revalidated.state === 'identity_required'
          ? 'Sign in to SciForge Cloud before continuing.'
          : revalidated.reason
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
    this.#authorityIdentityKey = null
    this.#authorityUserId = null
    this.#onAuthorityInvalidated('Cloud identity runtime closed.')
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

  #invalidateChangedAuthority(reason: string): void {
    const next = authorityIdentityKey(this.#identity.getStatus(), this.#device.getStatus())
    if (next === this.#authorityIdentityKey) return
    this.#authorityIdentityKey = next
    this.#onAuthorityInvalidated(reason)
  }

  #invalidateChangedUserAuthority(status: DesktopIdentityStatus): void {
    const nextUserId = authorityUserId(status)
    const nextIdentityKey = authorityIdentityKey(status, this.#device.getStatus())
    const userChanged = nextUserId !== this.#authorityUserId
    const authorityChanged = nextIdentityKey !== this.#authorityIdentityKey
    this.#authorityUserId = nextUserId
    this.#authorityIdentityKey = nextIdentityKey
    if (userChanged && authorityChanged) {
      this.#onAuthorityInvalidated('OIDC User authority changed.')
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

function authorityIdentityKey(
  identity: DesktopIdentityStatus,
  device: DesktopDeviceStatus
): string | null {
  if (identity.state !== 'signed-in' || device.state !== 'active') return null
  return `${identity.user.userId}\u0000${device.device.deviceId}`
}

function authorityUserId(identity: DesktopIdentityStatus): string | null {
  return identity.state === 'signed-in' ? identity.user.userId : null
}

function authenticatedCloudIdempotencyHeader(
  payload: AuthenticatedCloudRequest['payload']
): Readonly<Record<string, string>> {
  return 'idempotencyKey' in payload
    ? { 'idempotency-key': payload.idempotencyKey }
    : {}
}

function sameCloudIdentityUser(left: DesktopIdentityUser, right: DesktopIdentityUser): boolean {
  return left.userId === right.userId &&
    left.oidcIdentityId === right.oidcIdentityId &&
    left.issuer === right.issuer &&
    left.subject === right.subject
}

export function buildAccountConsoleUrl(issuer: string): string {
  const url = new URL(issuer)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('The configured Keycloak issuer must be a clean HTTPS URL.')
  }
  const issuerPath = url.pathname.replace(/\/+$/u, '')
  if (!issuerPath || issuerPath === '/') {
    throw new Error('The configured Keycloak issuer path is invalid.')
  }
  url.pathname = `${issuerPath}/account/`
  return url.toString()
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
