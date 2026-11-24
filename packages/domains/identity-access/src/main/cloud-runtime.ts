import { lookupDocumentShare, createDocumentShare, revokeDocumentShare, readDocumentComments, mutateDocumentComments } from './document-sharing.js'
import type { DocumentShareLookupRequest, DocumentShareCreateRequest, DocumentShareRevokeRequest, DocumentCommentReadRequest, DocumentCommentMutateRequest } from '@sciforge/document-sharing-contracts'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  AuthenticatedCloudTransportError,
  type AuthenticatedObjectStageInput,
  type AuthenticatedObjectReadInput,
  type AuthenticatedCloudRequest,
  type AuthenticatedCloudResponse,
  type AuthenticatedCloudTransportStatus,
  type AuthenticatedCloudExecutionOptions, authenticatedCloudBindingSchema
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
  resolveDesktopIdentityRuntimeConfig,
  type DesktopIdentityConfigurationInput
} from './cloud-runtime-config.js'
import { HttpCloudIdentityClient } from './cloud-identity-client.js'
import { fetchCloudCommand } from './cloud-command-fetch.js'
import { DesktopDeviceService } from './device-service.js'
import {
  DesktopIdentityError,
  DesktopIdentityService,
  type DesktopIdentitySessionIdentity
} from './oidc-service.js'
import { PrivateVaultDesktopIdentitySessionStore } from './session-store.js'
import type { IdentityPrivateVault } from './private-vault.js'
import type {
  DeviceFactSignatureMetadata,
  DeviceFactSigningRequest
} from '@sciforge/collaboration-contracts'
import { stageCloudObject, readCloudObject } from './cloud-object-transport.js'
import type { CloudTransportLease } from './cloud-authority.js'
import { listCloudSpaces, ensureCloudSpace, createCloudSpaceSession } from './cloud-spaces.js'
import type { CloudSpaceEnsureRequest, CloudSpaceSessionRequest } from '@sciforge/cloud-spaces-contracts'
import { restRequestSchema, restResponseSchema } from '@sciforge/collaboration-contracts'

type CloudIdentityRuntimeError = NonNullable<CloudIdentitySnapshot['error']>

const DEVICE_RECONNECTING_MESSAGE = 'Connection interrupted. Reconnecting to verify this device.'
const DEVICE_REJECTED_MESSAGE = 'Desktop Device authorization was rejected. Please check access.'

/** An invalidated permission lease is distinct from a Cloud business outcome. */
export type IdentityAuthorityInvalidation = Readonly<{
  code: 'device_unverified' | 'device_revoked' | 'device_changed' | 'device_rejected' |
    'identity_changed' | 'runtime_closed'
  message: string
}>

/**
 * Overall deadline for one canonical authenticated Cloud command request.
 * The transport aborts the underlying fetch with a real AbortSignal so a
 * stalled connection can never wait forever.
 */
const AUTHENTICATED_CLOUD_REQUEST_TIMEOUT_MS = 30_000

type CloudIdentityLinks = Pick<
  LocalCloudIdentityLinkService,
  'linkIdentity' | 'linkDevice' | 'clearActiveDevice' | 'setAuthenticatedCloudUser' | 'close'
>

export type CloudIdentityRuntimeOptions = Readonly<{
  userDataDir: string
  appRoot: string
  environment: Readonly<Record<string, string | undefined>>
  /** Package-owned Cloud settings; they override the deployment environment. */
  settings?: DesktopIdentityConfigurationInput['settings']
  installationId: string
  privateVault: IdentityPrivateVault
  externalNavigation?: DomainMainExternalNavigationHost
  appVersion?: string
  fetchImpl?: typeof fetch
  authenticatedCloudRequestTimeoutMs?: number
  onAuthorityInvalidated?: (reason: IdentityAuthorityInvalidation) => void
}>

type RuntimeProviders = Readonly<{
  identity: DesktopIdentityService
  device: DesktopDeviceService
  cloudBaseUrl: string | null
  transportUnavailableReason: string | null
}>

export class CloudIdentityRuntime {
  #options: CloudIdentityRuntimeOptions
  readonly #links: CloudIdentityLinks
  readonly #listeners = new Set<() => void>()
  #disposeIdentitySubscription: () => void = () => undefined
  #disposeDeviceSubscription: () => void = () => undefined
  #providers: RuntimeProviders
  readonly #fetch: typeof fetch
  readonly #authenticatedCloudRequestTimeoutMs: number
  readonly #onAuthorityInvalidated: (reason: IdentityAuthorityInvalidation) => void
  #revision = 1
  #identityError: CloudIdentityRuntimeError | undefined
  #deviceError: CloudIdentityRuntimeError | undefined
  #runtimeError: CloudIdentityRuntimeError | undefined
  #closed = false
  readonly #leasedOperations = new Set<AbortController>()
  readonly #commandOperations = new Set<AbortController>()
  #authorityEpoch = 0
  readonly #hostSessionEpoch = randomUUID()
  #authorityIdentityKey: string | null
  #authorityUserKey: string | null
  #authorityDeviceState: string

  private constructor(input: Readonly<{
    options: CloudIdentityRuntimeOptions
    providers: RuntimeProviders
    links: CloudIdentityLinks
    fetchImpl: typeof fetch
    authenticatedCloudRequestTimeoutMs: number
    onAuthorityInvalidated: (reason: IdentityAuthorityInvalidation) => void
    runtimeError?: CloudIdentityRuntimeError
  }>) {
    this.#options = input.options
    this.#providers = input.providers
    this.#links = input.links
    this.#fetch = input.fetchImpl
    this.#authenticatedCloudRequestTimeoutMs = input.authenticatedCloudRequestTimeoutMs
    this.#onAuthorityInvalidated = input.onAuthorityInvalidated
    this.#runtimeError = input.runtimeError
    this.#authorityIdentityKey = authorityIdentityKey(
      this.#identity.getStatus(),
      this.#device.getStatus()
    )
    this.#authorityUserKey = authorityUserKey(this.#identity.getStatus())
    this.#authorityDeviceState = deviceAuthorityState(this.#device.getStatus())
    this.#projectAuthenticatedUser(this.#identity.getStatus())
    this.#bindProviders()
  }

  #bindProviders(): void {
    this.#disposeIdentitySubscription()
    this.#disposeDeviceSubscription()
    try {
      this.#disposeIdentitySubscription = this.#identity.subscribe((status) => {
        this.#projectAuthenticatedUser(status)
        this.#invalidateChangedUserAuthority(status)
        this.#publish()
      })
      this.#disposeDeviceSubscription = this.#device.subscribe((status) => {
        // Connectivity is not an identity transition. Keep the last confirmed
        // binding for local work; Cloud transport and signing still require a
        // fresh ACTIVE Device and invalidate their own in-flight authority below.
        const temporarilyUnverified = status.state === 'error' && status.reasonCode === 'temporarily_unverified'
        if (status.state !== 'active' && !temporarilyUnverified) this.#clearActiveDeviceAuthority()
        if (status.state === 'active') this.#deviceError = undefined
        if (authorityUserKey(this.#identity.getStatus()) === this.#authorityUserKey) {
          this.#invalidateChangedAuthority(status)
        }
        this.#publish()
      })
    } catch (error) {
      this.#disposeIdentitySubscription()
      this.#disposeIdentitySubscription = () => undefined
      this.#disposeDeviceSubscription = () => undefined
      throw error
    }
  }

  get #identity(): DesktopIdentityService {
    return this.#providers.identity
  }

  get #device(): DesktopDeviceService {
    return this.#providers.device
  }

  get #cloudBaseUrl(): string | null {
    return this.#providers.cloudBaseUrl
  }

  get #transportUnavailableReason(): string | null {
    return this.#providers.transportUnavailableReason
  }

  static async create(options: CloudIdentityRuntimeOptions): Promise<CloudIdentityRuntime> {
    const appVersion = options.appVersion ?? await readApplicationVersion(options.appRoot)
    const runtimeOptions: CloudIdentityRuntimeOptions = { ...options, appVersion }
    const linkResult = createCloudIdentityLinks(options.userDataDir)
    const links = linkResult.links
    let providers: RuntimeProviders | undefined
    try {
      providers = createRuntimeProviders(runtimeOptions, links, appVersion)
      return new CloudIdentityRuntime({
        options: runtimeOptions,
        providers,
        links,
        fetchImpl: options.fetchImpl ?? fetch,
        authenticatedCloudRequestTimeoutMs:
          options.authenticatedCloudRequestTimeoutMs ?? AUTHENTICATED_CLOUD_REQUEST_TIMEOUT_MS,
        onAuthorityInvalidated: options.onAuthorityInvalidated ?? (() => undefined),
        ...(linkResult.error ? { runtimeError: linkResult.error } : {})
      })
    } catch (error) {
      const cleanupErrors: unknown[] = []
      for (const close of [
        () => providers?.device.close(),
        () => providers?.identity.close(),
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

  /**
   * Replace the deployment-bound providers in place.
   *
   * The canonical runtime instance, its listeners and its shared Local Account
   * link remain stable, so renderer resources and dependent domain services do
   * not observe a new runtime identity. The next sign-in uses the new issuer
   * and Cloud origin; an already saved session is restored only when it matches
   * the new issuer.
   */
  /**
   * Settings currently bound to this runtime, so an owner can avoid a
   * needless provider rebuild when the user saves unchanged values.
   */
  configuredSettings(): DesktopIdentityConfigurationInput['settings'] {
    return this.#options.settings ?? null
  }

  async reconfigure(settings: DesktopIdentityConfigurationInput['settings']): Promise<CloudIdentitySnapshot> {
    this.#assertOpen()
    const nextOptions: CloudIdentityRuntimeOptions = {
      ...this.#options,
      settings: settings ?? null
    }
    const appVersion = nextOptions.appVersion ?? await readApplicationVersion(nextOptions.appRoot)
    const next = createRuntimeProviders(nextOptions, this.#links, appVersion)
    let initialized: DesktopIdentityActionResult
    try {
      initialized = await next.identity.initialize()
    } catch (error) {
      next.device.close()
      next.identity.close()
      throw error
    }

    this.#disposeIdentitySubscription()
    this.#disposeDeviceSubscription()
    const previous = this.#providers
    this.#options = nextOptions
    this.#providers = next
    previous.device.close()
    previous.identity.close()
    this.#identityError = undefined
    this.#deviceError = undefined
    this.#runtimeError = undefined
    this.#bindProviders()
    this.#authorityIdentityKey = authorityIdentityKey(
      this.#identity.getStatus(),
      this.#device.getStatus()
    )
    this.#authorityUserKey = authorityUserKey(this.#identity.getStatus())
    this.#authorityDeviceState = deviceAuthorityState(this.#device.getStatus())
    this.#acceptIdentityResult(initialized)
    if (initialized.ok && initialized.status.state === 'signed-in') {
      this.#acceptDeviceResult(await this.#device.ensureRegistered())
    }
    this.#publish()
    return this.snapshot()
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

  async renameProfile(cloudUserId: string, displayName: string): Promise<void> {
    this.#assertOpen()
    const session = this.#identity.sessionIdentity()
    if (!session || session.userId !== cloudUserId) throw new Error('Sign in to this account before changing its cloud display name.')
    const requestId = () => `req_${randomUUID().replaceAll('-', '')}`
    const send = async (payload: AuthenticatedCloudRequest['payload']) => {
      const response = await this.executeAuthenticatedCloud({ contractVersion: 1,
        operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID, payload: restRequestSchema.parse(payload) })
      if (response.body.type === 'rest.error') throw new Error('The Cloud profile update was rejected. Check your access and retry after refreshing the account.')
      if (response.body.type !== 'rest.entity' || response.body.entity.type !== 'user_principal' ||
          response.body.entity.userId !== cloudUserId) throw new Error('Invalid cloud profile response.')
      return response.body.entity
    }
    const user = await send({ protocolVersion: '1.0', requestId: requestId(), type: 'user.get', userId: cloudUserId })
    if (this.#identity.sessionIdentity()?.generation !== session.generation) throw new Error('Account changed while saving the display name.')
    await send({ protocolVersion: '1.0', requestId: requestId(), type: 'user.update',
      userId: cloudUserId, displayName, expectedRevision: user.revision,
      idempotencyKey: `idem_${randomUUID()}` })
    await this.#identity.refreshProfile()
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
    await this.#refreshProfile()
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
        reasonCode: device.reasonCode === 'authority_rejected' ? 'authority_rejected' : 'authority_unverified',
        reason: device.reasonCode === 'authority_rejected'
          ? DEVICE_REJECTED_MESSAGE
          : DEVICE_RECONNECTING_MESSAGE
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
        reasonCode: 'authority_unverified',
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

  authenticatedCloudHostStatus() {
    const status = this.authenticatedCloudTransportStatus()
    const session = this.#identity.sessionIdentity()
    if (status.state !== 'ready' || !session || session.userId !== status.userId) {
      throw new AuthenticatedCloudTransportError('identity_required', 'Cloud Host requires a ready authenticated session.')
    }
    return { ...status, sessionGeneration: `${this.#hostSessionEpoch}:${session.generation}` }
  }

  #assertExpectedCloudBinding(options?: AuthenticatedCloudExecutionOptions): void {
    if (!options?.expectedBinding) return
    const expected = authenticatedCloudBindingSchema.parse(options.expectedBinding)
    const current = this.authenticatedCloudHostStatus()
    if (Object.entries(expected).some(([key, value]) => current[key as keyof typeof expected] !== value)) {
      throw new AuthenticatedCloudTransportError('identity_required', 'Cloud Host expected identity binding changed.')
    }
  }

  async executeAuthenticatedCloud(
    request: AuthenticatedCloudRequest,
    options?: AuthenticatedCloudExecutionOptions
  ): Promise<AuthenticatedCloudResponse> {
    this.#assertOpen()
    this.#assertExpectedCloudBinding(options)
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
    const initialSession = this.#identity.sessionIdentity()
    if (!initialSession) {
      throw new AuthenticatedCloudTransportError(
        'identity_required',
        'Sign in to SciForge Cloud before continuing.'
      )
    }
    const controller = new AbortController()
    const authorityEpoch = this.#authorityEpoch
    this.#commandOperations.add(controller)
    const abortFromCaller = (): void => { controller.abort(options?.signal?.reason) }
    options?.signal?.addEventListener('abort', abortFromCaller, { once: true })
    if (options?.signal?.aborted) abortFromCaller()
    const timeout = setTimeout(() => {
      controller.abort(new AuthenticatedCloudTransportError(
        'cloud_timeout',
        'SciForge Cloud request timed out.'
      ))
    }, this.#authenticatedCloudRequestTimeoutMs)
    try {
      const revalidated = await waitWithSignal(this.revalidateCurrentDevice(), controller.signal)
      if (revalidated.state !== 'ready') {
        throw new AuthenticatedCloudTransportError(
          revalidated.state === 'identity_required'
            ? 'identity_required'
            : revalidated.state === 'device_required'
              ? 'device_required'
              : revalidated.reasonCode === 'authority_unverified' ? 'authority_unverified'
                : revalidated.reasonCode === 'authority_rejected' ? 'device_required' : 'cloud_unavailable',
          revalidated.state === 'identity_required'
            ? 'Sign in to SciForge Cloud before continuing.'
            : revalidated.reason
        )
      }

      const assertCurrent = (): void => {
        if (controller.signal.aborted) throw controller.signal.reason
        this.#assertSessionIdentity(initialSession)
        this.#assertExpectedCloudBinding(options)
        const current = this.authenticatedCloudTransportStatus()
        if (authorityEpoch !== this.#authorityEpoch || current.state !== 'ready' ||
            current.userId !== revalidated.userId || current.deviceId !== revalidated.deviceId ||
            current.deviceRevision !== revalidated.deviceRevision) {
          throw new AuthenticatedCloudTransportError(
            'device_required', 'The authenticated Cloud permission lease is no longer current.'
          )
        }
      }
      assertCurrent()
      const response = await waitWithSignal(this.#identity.useAccessToken((accessToken) => {
        // Token freshness may await a refresh. Fence immediately before dispatch,
        // in the same synchronous turn that selects the token for this request.
        assertCurrent()
        return this.#fetchCloudCommand(request, accessToken, controller.signal, initialSession, assertCurrent)
      }), controller.signal)
      assertCurrent()
      const body = await waitWithSignal(readAuthenticatedCloudBody(response), controller.signal)
      assertCurrent()
      return {
        contractVersion: 1,
        status: response.status,
        body
      }
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof AuthenticatedCloudTransportError) {
        throw controller.signal.reason
      }
      if (error instanceof AuthenticatedCloudTransportError) throw error
      if (error instanceof DesktopIdentityError) throw authenticationFailure(error)
      throw new AuthenticatedCloudTransportError('cloud_unavailable', 'SciForge Cloud is unavailable.', { cause: error })
    } finally {
      this.#commandOperations.delete(controller)
      clearTimeout(timeout)
      options?.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  async #fetchCloudCommand(
    request: AuthenticatedCloudRequest,
    accessToken: string,
    signal: AbortSignal,
    session: DesktopIdentitySessionIdentity,
    assertCurrent: () => void
  ): Promise<Response> {
    const baseUrl = this.#cloudBaseUrl
    if (!baseUrl) {
      throw new AuthenticatedCloudTransportError(
        'transport_unavailable',
        this.#transportUnavailableReason ?? 'SciForge Cloud is not configured.'
      )
    }
    const send = (token: string): Promise<Response> => {
      assertCurrent()
      return fetchCloudCommand(this.#fetch,
      `${baseUrl}/v1/commands`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json',
          ...authenticatedCloudIdempotencyHeader(request.payload)
        },
        body: JSON.stringify(request.payload),
        signal
      }
      )
    }
    this.#assertSessionIdentity(session)
    const response = await send(accessToken)
    if (response.status !== 401) return response
    await response.body?.cancel().catch(() => undefined)
    // The Cloud rejected this exact access token. Refresh once through the
    // single Identity session path, then replay the original request only if
    // the signed-in account is still the one that issued it.
    const renewed = await this.#identity.renewAccessToken(accessToken, session)
    this.#assertSessionIdentity(session)
    return send(renewed)
  }

  stageAuthenticatedCloudObject(input: AuthenticatedObjectStageInput, options?: Readonly<{ signal?: AbortSignal }>) {
    return stageCloudObject(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  readAuthenticatedCloudObject(input: AuthenticatedObjectReadInput, options?: Readonly<{ signal?: AbortSignal }>) {
    return readCloudObject(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  lookupDocumentShare(input: DocumentShareLookupRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    return lookupDocumentShare(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  createDocumentShare(input: DocumentShareCreateRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    return createDocumentShare(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  revokeDocumentShare(input: DocumentShareRevokeRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    return revokeDocumentShare(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  readDocumentComments(input: DocumentCommentReadRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    return readDocumentComments(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  mutateDocumentComments(input: DocumentCommentMutateRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    return mutateDocumentComments(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  listAuthenticatedCloudSpaces(options?: Readonly<{ signal?: AbortSignal }>) {
    return listCloudSpaces((operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  ensureAuthenticatedCloudSpace(input: CloudSpaceEnsureRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    return ensureCloudSpace(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  createAuthenticatedCloudSpaceSession(input: CloudSpaceSessionRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    return createCloudSpaceSession(input, (operation, requestOptions) => this.#withCloudAuthority(operation, requestOptions), options)
  }

  async #withCloudAuthority<Result>(operation: (lease: CloudTransportLease) => Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
    this.#assertOpen()
    let available = this.authenticatedCloudTransportStatus()
    // A transient verification failure must not permanently fence the very
    // request that can verify the device again. Preserve the initiating account
    // across recovery; a revoked or replaced device still fails the normal gate.
    if (available.state === 'unavailable' && available.reasonCode === 'authority_unverified') {
      const recoveringSession = this.#identity.sessionIdentity()
      const recovery = this.revalidateCurrentDevice()
      available = options?.signal ? await waitWithSignal(recovery, options.signal) : await recovery
      this.#assertOpen()
      if (recoveringSession) this.#assertSessionIdentity(recoveringSession)
    }
    const initial = available
    if (initial.state !== 'ready') {
      throw new AuthenticatedCloudTransportError(initial.state === 'identity_required' ? 'identity_required' :
        initial.state === 'device_required' ? 'device_required' : 'transport_unavailable', 'Cloud access requires a current signed-in User and active Device.')
    }
    const initialSession = this.#identity.sessionIdentity()
    if (!initialSession) {
      throw new AuthenticatedCloudTransportError(
        'identity_required',
        'Cloud access requires a current signed-in User and active Device.'
      )
    }
    const controller = new AbortController()
    this.#leasedOperations.add(controller)
    const abort = (): void => { controller.abort() }
    options?.signal?.addEventListener('abort', abort, { once: true })
    if (options?.signal?.aborted) abort()
    const assertCurrent = (): void => {
      const current = this.#closed ? null : this.authenticatedCloudTransportStatus()
      if (controller.signal.aborted || current?.state !== 'ready' || current.userId !== initial.userId ||
        current.deviceId !== initial.deviceId || current.deviceRevision !== initial.deviceRevision) {
        abort()
        throw new AuthenticatedCloudTransportError('operation_not_allowed', 'The Cloud request identity, Device or cancellation lease is no longer current.')
      }
    }
    const observe = (): void => { try { assertCurrent() } catch { abort() } }
    const stopIdentity = this.#identity.subscribe(observe)
    const stopDevice = this.#device.subscribe(observe)
    try {
      assertCurrent()
      await this.revalidateCurrentDevice()
      assertCurrent()
      const result = await this.#identity.useAccessToken((initialToken) => {
        let token = initialToken
        return operation({
          userId: initial.userId, assertCurrent,
          fetch: async (path, init) => {
            assertCurrent()
            this.#assertSessionIdentity(initialSession)
            const send = (authorization: string): Promise<Response> => this.#fetch(`${initial.baseUrl}${path}`, {
              ...init, headers: { ...init.headers, authorization: `Bearer ${authorization}` },
              redirect: 'error', signal: controller.signal
            })
            let response = await send(token)
            if (response.status === 401) {
              await response.body?.cancel().catch(() => undefined)
              token = await this.#identity.renewAccessToken(token, initialSession)
              assertCurrent()
              this.#assertSessionIdentity(initialSession)
              response = await send(token)
            }
            try { assertCurrent() } catch (error) { await response.body?.cancel(); throw error }
            return response
          }
        })
      })
      assertCurrent()
      return result
    } catch (error) {
      if (error instanceof AuthenticatedCloudTransportError) throw error
      if (error instanceof DesktopIdentityError) throw authenticationFailure(error)
      throw new AuthenticatedCloudTransportError('cloud_unavailable', 'The Cloud operation did not complete; reconcile the original operation before retrying.', { cause: error })
    } finally {
      stopIdentity()
      stopDevice()
      options?.signal?.removeEventListener('abort', abort)
      this.#leasedOperations.delete(controller)
    }
  }

  #assertSessionIdentity(expected: DesktopIdentitySessionIdentity): void {
    const current = this.#identity.sessionIdentity()
    if (!current || current.generation !== expected.generation || current.userId !== expected.userId) {
      throw new DesktopIdentityError(
        'OIDC_SESSION_EXPIRED',
        'The signed-in identity changed before the rejected request could be replayed.'
      )
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const controller of this.#leasedOperations) controller.abort()
    this.#leasedOperations.clear()
    this.#authorityIdentityKey = null
    this.#authorityUserKey = null
    this.#invalidateAuthority({ code: 'runtime_closed', message: 'Cloud identity runtime closed.' })
    this.#disposeDeviceSubscription()
    this.#disposeIdentitySubscription()
    this.#device.close()
    this.#identity.close()
    this.#links.close()
    this.#listeners.clear()
  }

  #profileRefresh: Promise<void> | null = null
  #profileRefreshedAt = 0

  async #refreshProfile(): Promise<void> {
    if (Date.now() - this.#profileRefreshedAt < 30_000) return
    if (!this.#profileRefresh) {
      this.#profileRefresh = this.#identity.refreshProfile().then(() => {
        this.#profileRefreshedAt = Date.now()
      }).finally(() => { this.#profileRefresh = null })
    }
    await this.#profileRefresh
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

  #invalidateChangedAuthority(status: DesktopDeviceStatus): void {
    const next = authorityIdentityKey(this.#identity.getStatus(), this.#device.getStatus())
    const nextState = deviceAuthorityState(status)
    if (status.state === 'active') {
      // Revalidation restores permission only for new calls. It does not
      // revoke the durable human intent whose former I/O lease was aborted.
      const changed = this.#authorityIdentityKey !== null && next !== this.#authorityIdentityKey
      this.#authorityIdentityKey = next
      this.#authorityDeviceState = nextState
      if (changed) this.#invalidateAuthority({
        code: 'device_changed', message: 'Desktop Device authority changed.'
      })
      return
    }
    if (nextState === this.#authorityDeviceState) return
    this.#authorityDeviceState = nextState
    // Retain only the non-secret previous binding for change detection. It
    // grants no access: status() and every operation require fresh ACTIVE proof.
    this.#invalidateAuthority({
      code: status.state === 'error'
        ? status.reasonCode === 'authority_rejected' ? 'device_rejected' : 'device_unverified'
        : status.state === 'revoked' ? 'device_revoked' : 'device_changed',
      message: status.state === 'error'
        ? status.reasonCode === 'authority_rejected'
          ? DEVICE_REJECTED_MESSAGE
          : DEVICE_RECONNECTING_MESSAGE
        : 'Desktop Device authority changed.'
    })
  }

  #invalidateChangedUserAuthority(status: DesktopIdentityStatus): void {
    const nextUserKey = authorityUserKey(status)
    const userChanged = nextUserKey !== this.#authorityUserKey
    this.#authorityUserKey = nextUserKey
    if (userChanged) {
      this.#authorityIdentityKey = authorityIdentityKey(status, this.#device.getStatus())
      this.#invalidateAuthority({ code: 'identity_changed', message: 'OIDC User authority changed.' })
    }
  }

  #invalidateAuthority(reason: IdentityAuthorityInvalidation): void {
    this.#authorityEpoch += 1
    const error = new AuthenticatedCloudTransportError(
      reason.code === 'device_unverified' ? 'authority_unverified' :
        reason.code === 'identity_changed' ? 'identity_required' : 'device_required',
      reason.message
    )
    for (const controller of this.#commandOperations) controller.abort(error)
    this.#onAuthorityInvalidated(reason)
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

function authenticationFailure(error: DesktopIdentityError): AuthenticatedCloudTransportError {
  if (error.code === 'OIDC_PROVIDER_UNAVAILABLE' || error.code === 'SCIFORGE_CLOUD_UNAVAILABLE') {
    return new AuthenticatedCloudTransportError('cloud_unavailable', error.message, { cause: error })
  }
  return new AuthenticatedCloudTransportError('identity_required', error.message, { cause: error })
}

function authorityIdentityKey(
  identity: DesktopIdentityStatus,
  device: DesktopDeviceStatus
): string | null {
  if (identity.state !== 'signed-in' || device.state !== 'active') return null
  return `${identity.user.userId}\u0000${device.device.deviceId}`
}

function authorityUserKey(identity: DesktopIdentityStatus): string | null {
  return identity.state === 'signed-in'
    ? [identity.user.userId, identity.user.oidcIdentityId, identity.user.issuer, identity.user.subject].join('\u0000')
    : null
}

function deviceAuthorityState(status: DesktopDeviceStatus): string {
  return status.state === 'error' ? `${status.state}:${status.reasonCode}` : status.state
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

function createRuntimeProviders(
  options: CloudIdentityRuntimeOptions,
  links: CloudIdentityLinks,
  appVersion: string
): RuntimeProviders {
  const identityConfig = resolveDesktopIdentityRuntimeConfig({
    oidcIssuer: options.environment.SCIFORGE_OIDC_ISSUER,
    cloudBaseUrl: options.environment.SCIFORGE_CLOUD_BASE_URL,
    settings: options.settings
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
    return {
      identity,
      device,
      cloudBaseUrl,
      transportUnavailableReason: configurationError || null
    }
  } catch (error) {
    device?.close()
    identity?.close()
    throw error
  }
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

/**
 * End an await with the caller's AbortSignal. The underlying operation keeps
 * its own lifecycle (the device service is single-flight, so a later call
 * reuses it); only this waiter is released with the signal's reason.
 */
function waitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}
