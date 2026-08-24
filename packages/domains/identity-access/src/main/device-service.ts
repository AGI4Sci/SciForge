import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type JsonWebKey as CryptoJsonWebKey
} from 'node:crypto'
import { hostname, release } from 'node:os'
import {
  canonicalEnrollmentBytes,
  ed25519PublicJwkSchema,
  installationIdSchema,
  type Device,
  type Ed25519PublicJwk
} from '@sciforge/collaboration-contracts'
import type {
  CollaborationIdentityClient,
  IdentityAccessContext
} from '@sciforge/collaboration-identity'
import type { DomainMainPackageSecretStoreHost } from '@sciforge/domain-sdk/package-storage'
import type {
  DesktopDeviceActionResult,
  DesktopDeviceStatus,
  DesktopDeviceSummary,
  DesktopIdentityStatus
} from '../contract.js'
import type { DesktopIdentityService } from './oidc-service.js'

export type DesktopDeviceServiceOptions = Readonly<{
  identity: Pick<DesktopIdentityService, 'getStatus' | 'getAccessToken' | 'subscribe'>
  client: CollaborationIdentityClient
  installationSeed: string
  secrets: DomainMainPackageSecretStoreHost
  appVersion: string
  platform?: NodeJS.Platform
  architecture?: string
  osVersion?: string
  displayName?: string
  capabilities?: readonly string[]
  linkDevice?: (device: Device) => void
}>

type StoredDeviceKey = Readonly<{
  version: 1
  publicKey: Ed25519PublicJwk
  privateKey: CryptoJsonWebKey
}>

type IdentityLease = Readonly<{
  epoch: number
  userId: string
  oidcIdentityId: string
  issuer: string
  subject: string
  context: IdentityAccessContext
}>

type IdentityAuthority = Pick<
  IdentityLease,
  'userId' | 'oidcIdentityId' | 'issuer' | 'subject'
>

type DeviceOperationLease = IdentityLease & Readonly<{
  operationSequence: number
}>

type DeviceOperation = Readonly<{
  epoch: number
  operationSequence: number
  kind: 'enrollment' | 'refresh' | 'revoke'
  promise: Promise<DesktopDeviceActionResult>
}>

const DEVICE_KEY_SECRET = 'device.key'

export type DesktopDeviceStatusListener = (status: DesktopDeviceStatus) => void

export class DesktopDeviceService {
  readonly #identity: DesktopDeviceServiceOptions['identity']
  readonly #client: CollaborationIdentityClient
  readonly #installationId: string
  readonly #secrets: DomainMainPackageSecretStoreHost
  readonly #platform: Device['platform']
  readonly #displayName: string
  readonly #capabilities: readonly string[]
  readonly #linkDevice: DesktopDeviceServiceOptions['linkDevice']
  readonly #listeners = new Set<DesktopDeviceStatusListener>()
  readonly #disposeIdentitySubscription: () => void
  #status: DesktopDeviceStatus
  #devices: DesktopDeviceSummary[] = []
  #operation: DeviceOperation | null = null
  #identityAuthority: IdentityAuthority | null
  #identityEpoch = 1
  #deviceOperationSequence = 0
  #closed = false

  constructor(options: DesktopDeviceServiceOptions) {
    this.#identity = options.identity
    this.#client = options.client
    this.#installationId = cloudInstallationId(options.installationSeed)
    this.#secrets = options.secrets
    this.#platform = devicePlatform(options)
    this.#displayName = options.displayName?.trim() || hostname() || 'SciForge Desktop'
    this.#capabilities = options.capabilities ?? ['agent.execute', 'workspace.read']
    this.#linkDevice = options.linkDevice
    const initialIdentity = options.identity.getStatus()
    this.#identityAuthority = identityAuthority(initialIdentity)
    this.#status = initialIdentity.state === 'signed-in'
      ? { state: 'not-enrolled' }
      : { state: 'signed-out' }
    this.#disposeIdentitySubscription = options.identity.subscribe((status) => {
      this.#handleIdentityStatus(status)
    })
  }

  getStatus(): DesktopDeviceStatus {
    return this.#status
  }

  listDevices(): readonly DesktopDeviceSummary[] {
    return [...this.#devices]
  }

  subscribe(listener: DesktopDeviceStatusListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  ensureRegistered(): Promise<DesktopDeviceActionResult> {
    let identityLease: IdentityLease
    try {
      const captured = this.#captureIdentityLease()
      if (!captured) {
        if (!this.#closed) this.#publish({ state: 'signed-out' })
        return Promise.resolve({
          ok: false,
          status: this.#status,
          devices: [],
          message: 'Sign in before registering this Desktop.'
        })
      }
      identityLease = captured
    } catch (error) {
      return Promise.resolve(this.#failure(error))
    }
    if (this.#operation?.epoch === identityLease.epoch) {
      if (this.#operation.kind === 'enrollment' || this.#operation.kind === 'revoke') {
        return this.#operation.promise
      }
    }
    const lease = this.#beginDeviceOperation(identityLease)
    return this.#trackOperation('enrollment', lease, this.#performEnrollment(lease))
  }

  refresh(): Promise<DesktopDeviceActionResult> {
    try {
      const identityLease = this.#captureIdentityLease()
      if (!identityLease) return Promise.resolve(this.#signedOutResult())
      if (this.#operation?.epoch === identityLease.epoch && this.#operation.kind === 'revoke') {
        return this.#operation.promise
      }
      const lease = this.#beginDeviceOperation(identityLease)
      return this.#trackOperation('refresh', lease, this.#performRefresh(lease))
    } catch (error) {
      return Promise.resolve(this.#failure(error))
    }
  }

  async #performRefresh(lease: DeviceOperationLease): Promise<DesktopDeviceActionResult> {
    try {
      const response = await this.#client.listDevices(lease.context)
      if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
      const devices = response.devices.map(toSummary)
      const current = response.devices.find((device) => device.installationId === this.#installationId)
      if (current) {
        if (!this.#identityLink(current, lease)) return this.#staleResult()
      }
      if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
      this.#devices = devices
      this.#publish(current
        ? current.status === 'revoked'
          ? { state: 'revoked', device: toSummary(current) }
          : { state: 'active', device: toSummary(current) }
        : { state: 'not-enrolled' })
      return { ok: true, status: this.#status, devices: this.listDevices() as DesktopDeviceSummary[] }
    } catch (error) {
      return this.#failure(error, lease)
    }
  }

  revoke(deviceId: string): Promise<DesktopDeviceActionResult> {
    let identityLease: IdentityLease
    try {
      const captured = this.#captureIdentityLease()
      if (!captured) return Promise.resolve(this.#signedOutResult())
      identityLease = captured
    } catch (error) {
      return Promise.resolve(this.#failure(error))
    }
    if (this.#operation?.epoch === identityLease.epoch && this.#operation.kind === 'revoke') {
      return this.#operation.promise
    }
    const lease = this.#beginDeviceOperation(identityLease)
    return this.#trackOperation('revoke', lease, this.#performRevoke(deviceId, lease))
  }

  async #performRevoke(
    deviceId: string,
    lease: DeviceOperationLease
  ): Promise<DesktopDeviceActionResult> {
    try {
      await this.#client.revokeDevice(lease.context, {
        deviceId,
        idempotencyKey: desktopIdempotencyKey('device-revoke')
      })
      if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
      return await this.#performRefresh(lease)
    } catch (error) {
      return this.#failure(error, lease)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#identityEpoch += 1
    this.#deviceOperationSequence += 1
    this.#operation = null
    this.#disposeIdentitySubscription()
    this.#devices = []
    this.#status = { state: 'signed-out' }
    this.#listeners.clear()
  }

  async #performEnrollment(lease: DeviceOperationLease): Promise<DesktopDeviceActionResult> {
    if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
    try {
      const listed = await this.#client.listDevices(lease.context)
      if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
      const devices = listed.devices.map(toSummary)
      const existing = listed.devices.find((device) => device.installationId === this.#installationId)
      if (existing?.status === 'active') {
        if (!this.#identityLink(existing, lease)) return this.#staleResult()
        this.#devices = devices
        this.#publish({ state: 'active', device: toSummary(existing) })
        return { ok: true, status: this.#status, devices: this.listDevices() as DesktopDeviceSummary[] }
      }
      if (existing?.status === 'revoked') {
        if (!this.#identityLink(existing, lease)) return this.#staleResult()
        this.#devices = devices
        this.#publish({ state: 'revoked', device: toSummary(existing) })
        return {
          ok: false,
          status: this.#status,
          devices: this.listDevices() as DesktopDeviceSummary[],
          message: 'This Desktop was revoked. Re-enrollment requires an explicit cloud recovery flow.'
        }
      }

      this.#devices = devices
      this.#publish({ state: 'enrolling' })
      const key = await this.#loadOrCreateKey()
      if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
      const challenge = await this.#client.createDeviceEnrollment(lease.context, {
        installationId: this.#installationId,
        idempotencyKey: desktopIdempotencyKey('device-enrollment')
      })
      if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
      const signature = sign(
        null,
        canonicalEnrollmentBytes({
          enrollmentId: challenge.enrollmentId,
          nonce: challenge.nonce,
          userId: lease.userId,
          installationId: this.#installationId,
          expiresAt: challenge.expiresAt
        }),
        createPrivateKey({ key: key.privateKey, format: 'jwk' })
      ).toString('base64url')
      await this.#client.createDevice(lease.context, {
        enrollmentId: challenge.enrollmentId,
        nonce: challenge.nonce,
        installationId: this.#installationId,
        displayName: this.#displayName,
        platform: this.#platform,
        publicKeyJwk: key.publicKey,
        capabilitySummary: [...this.#capabilities],
        signature,
        idempotencyKey: desktopIdempotencyKey('device-create')
      })
      if (!this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
      return await this.#performRefresh(lease)
    } catch (error) {
      return this.#failure(error, lease)
    }
  }

  #captureIdentityLease(): IdentityLease | null {
    if (this.#closed) return null
    const accessToken = this.#identity.getAccessToken()
    const identity = this.#identity.getStatus()
    if (identity.state !== 'signed-in') return null
    if (!accessToken) throw new Error('The SciForge Cloud access token is unavailable.')
    return {
      epoch: this.#identityEpoch,
      userId: identity.user.userId,
      oidcIdentityId: identity.user.oidcIdentityId,
      issuer: identity.user.issuer,
      subject: identity.user.subject,
      context: { accessToken }
    }
  }

  async #loadOrCreateKey(): Promise<{ publicKey: Ed25519PublicJwk; privateKey: CryptoJsonWebKey }> {
    const existing = await this.#secrets.read(DEVICE_KEY_SECRET)
    if (existing) {
      const stored = JSON.parse(existing) as StoredDeviceKey
      if (stored.version !== 1) throw new Error('The stored Desktop key has an unsupported version.')
      const publicKey = ed25519PublicJwkSchema.parse(stored.publicKey)
      const privateKey = stored.privateKey
      if (privateKey.kty !== 'OKP' || privateKey.crv !== 'Ed25519' || typeof privateKey.d !== 'string') {
        throw new Error('The stored Desktop private key is invalid.')
      }
      return { publicKey, privateKey }
    }

    const pair = generateKeyPairSync('ed25519')
    const exportedPublic = pair.publicKey.export({ format: 'jwk' })
    const privateKey = pair.privateKey.export({ format: 'jwk' })
    const x = String(exportedPublic.x ?? '')
    const publicKey = ed25519PublicJwkSchema.parse({
      kty: 'OKP',
      crv: 'Ed25519',
      alg: 'EdDSA',
      use: 'sig',
      kid: `device-${createHash('sha256').update(x).digest('hex').slice(0, 16)}`,
      x
    })
    await this.#secrets.write(DEVICE_KEY_SECRET, JSON.stringify({
      version: 1,
      publicKey,
      privateKey
    } satisfies StoredDeviceKey))
    return { publicKey, privateKey }
  }

  #handleIdentityStatus(status: DesktopIdentityStatus): void {
    const nextAuthority = identityAuthority(status)
    if (sameIdentityAuthority(this.#identityAuthority, nextAuthority)) {
      if (!this.#closed && status.state === 'signed-in') {
        void this.refresh().catch(() => undefined)
      }
      return
    }
    this.#identityAuthority = nextAuthority
    this.#identityEpoch += 1
    this.#deviceOperationSequence += 1
    this.#operation = null
    if (this.#closed) return
    this.#devices = []
    if (status.state === 'signed-out') {
      this.#publish({ state: 'signed-out' })
      return
    }
    this.#publish({ state: 'not-enrolled' })
    void this.ensureRegistered().catch(() => undefined)
  }

  #failure(
    error: unknown,
    lease?: DeviceOperationLease
  ): DesktopDeviceActionResult {
    if (lease && !this.#isOperationLeaseCurrent(lease)) return this.#staleResult()
    if (this.#closed) return this.#staleResult()
    const message = error instanceof Error ? error.message : 'Desktop device registration failed.'
    this.#publish({ state: 'error', message })
    return { ok: false, status: this.#status, devices: this.listDevices() as DesktopDeviceSummary[], message }
  }

  #identityLink(device: Device, lease: DeviceOperationLease): boolean {
    if (!this.#isOperationLeaseCurrent(lease)) return false
    this.#linkDevice?.(device)
    return this.#isOperationLeaseCurrent(lease)
  }

  #publish(status: DesktopDeviceStatus): void {
    if (this.#closed) return
    this.#status = status
    for (const listener of this.#listeners) {
      try {
        listener(status)
      } catch {
        // Device status observers cannot interrupt enrollment transitions.
      }
    }
  }

  #isIdentityLeaseCurrent(lease: IdentityLease): boolean {
    if (this.#closed || lease.epoch !== this.#identityEpoch) return false
    const identity = this.#identity.getStatus()
    return lease.epoch === this.#identityEpoch &&
      identity.state === 'signed-in' &&
      identity.user.userId === lease.userId &&
      identity.user.oidcIdentityId === lease.oidcIdentityId &&
      identity.user.issuer === lease.issuer &&
      identity.user.subject === lease.subject
  }

  #isOperationLeaseCurrent(lease: DeviceOperationLease): boolean {
    return lease.operationSequence === this.#deviceOperationSequence &&
      this.#isIdentityLeaseCurrent(lease)
  }

  #beginDeviceOperation(identityLease: IdentityLease): DeviceOperationLease {
    this.#deviceOperationSequence += 1
    return { ...identityLease, operationSequence: this.#deviceOperationSequence }
  }

  #trackOperation(
    kind: DeviceOperation['kind'],
    lease: DeviceOperationLease,
    operation: Promise<DesktopDeviceActionResult>
  ): Promise<DesktopDeviceActionResult> {
    const promise = operation.finally(() => {
      if (this.#operation?.promise === promise) this.#operation = null
    })
    this.#operation = {
      epoch: lease.epoch,
      operationSequence: lease.operationSequence,
      kind,
      promise
    }
    return promise
  }

  #signedOutResult(): DesktopDeviceActionResult {
    if (!this.#closed) {
      this.#devices = []
      this.#publish({ state: 'signed-out' })
    }
    return {
      ok: false,
      status: this.#status,
      devices: [],
      message: 'Sign in before using this Desktop Device.'
    }
  }

  #staleResult(): DesktopDeviceActionResult {
    return {
      ok: false,
      status: this.#status,
      devices: this.listDevices() as DesktopDeviceSummary[],
      message: 'The Desktop Device operation was superseded by an identity change.'
    }
  }
}

export function cloudInstallationId(seed: string): string {
  const existing = installationIdSchema.safeParse(seed)
  if (existing.success) return existing.data
  return `ins_${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`
}

function devicePlatform(options: DesktopDeviceServiceOptions): Device['platform'] {
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'
  const arch = architecture === 'arm64' ? 'arm64' : 'x64'
  const osVersion = options.osVersion ?? release()
  return { os, arch, osVersion, appVersion: options.appVersion }
}

function toSummary(device: Device): DesktopDeviceSummary {
  return {
    deviceId: device.deviceId,
    displayName: device.displayName,
    status: device.status,
    platform: device.platform,
    ...(device.revokedAt ? { revokedAt: device.revokedAt } : {})
  }
}

function desktopIdempotencyKey(operation: string): string {
  return `idem_desktop_${operation}_${randomUUID()}`
}

function identityAuthority(status: DesktopIdentityStatus): IdentityAuthority | null {
  if (status.state !== 'signed-in') return null
  return {
    userId: status.user.userId,
    oidcIdentityId: status.user.oidcIdentityId,
    issuer: status.user.issuer,
    subject: status.user.subject
  }
}

function sameIdentityAuthority(
  left: IdentityAuthority | null,
  right: IdentityAuthority | null
): boolean {
  if (left === null || right === null) return left === right
  return left.userId === right.userId &&
    left.oidcIdentityId === right.oidcIdentityId &&
    left.issuer === right.issuer &&
    left.subject === right.subject
}
