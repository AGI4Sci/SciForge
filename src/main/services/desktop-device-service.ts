import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type JsonWebKey as CryptoJsonWebKey
} from 'node:crypto'
import { chmod, readFile } from 'node:fs/promises'
import { hostname, release } from 'node:os'
import { join } from 'node:path'
import {
  canonicalDeviceEnrollmentBytes,
  ed25519PublicJwkSchema,
  installationIdSchema,
  type Device,
  type Ed25519PublicJwk
} from '@sciforge/collaboration-contracts'
import type {
  CollaborationIdentityClient,
  IdentityAccessContext
} from '@sciforge/collaboration-identity'
import type {
  DesktopDeviceActionResult,
  DesktopDeviceStatus,
  DesktopDeviceSummary,
  DesktopIdentityStatus
} from '../../shared/desktop-identity'
import { atomicWriteFile } from '../atomic-write-file'
import type { DesktopIdentityService } from './desktop-identity-service'

type Encryption = Readonly<{
  state: () => 'available' | 'unavailable' | 'insecure'
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}>

type DesktopDeviceServiceOptions = Readonly<{
  identity: Pick<DesktopIdentityService, 'getStatus' | 'getAccessToken' | 'subscribe'>
  client: CollaborationIdentityClient
  installationSeed: string
  userDataDir: string
  encryption: Encryption
  appVersion: string
  platform?: NodeJS.Platform
  architecture?: string
  osVersion?: string
  displayName?: string
  capabilities?: readonly string[]
  linkDevice?: (device: Device) => void | Promise<void>
}>

type StoredDeviceKey = Readonly<{
  version: 1
  publicKey: Ed25519PublicJwk
  encryptedPrivateKey: string
}>

export type DesktopDeviceStatusListener = (status: DesktopDeviceStatus) => void

export class DesktopDeviceService {
  readonly #identity: DesktopDeviceServiceOptions['identity']
  readonly #client: CollaborationIdentityClient
  readonly #installationId: string
  readonly #keyPath: string
  readonly #encryption: Encryption
  readonly #platform: Device['platform']
  readonly #displayName: string
  readonly #capabilities: readonly string[]
  readonly #linkDevice: DesktopDeviceServiceOptions['linkDevice']
  readonly #listeners = new Set<DesktopDeviceStatusListener>()
  readonly #disposeIdentitySubscription: () => void
  #status: DesktopDeviceStatus
  #devices: DesktopDeviceSummary[] = []
  #operation: Promise<DesktopDeviceActionResult> | null = null

  constructor(options: DesktopDeviceServiceOptions) {
    this.#identity = options.identity
    this.#client = options.client
    this.#installationId = cloudInstallationId(options.installationSeed)
    this.#keyPath = join(options.userDataDir, 'collaboration-identity', 'device-key.json')
    this.#encryption = options.encryption
    this.#platform = devicePlatform(options)
    this.#displayName = options.displayName?.trim() || hostname() || 'SciForge Desktop'
    this.#capabilities = options.capabilities ?? ['agent.execute', 'workspace.read']
    this.#linkDevice = options.linkDevice
    this.#status = options.identity.getStatus().state === 'signed-in'
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
    if (this.#operation) return this.#operation
    this.#operation = this.#performEnrollment().finally(() => {
      this.#operation = null
    })
    return this.#operation
  }

  async refresh(): Promise<DesktopDeviceActionResult> {
    try {
      const context = this.#accessContext()
      const response = await this.#client.listDevices(context)
      this.#devices = response.devices.map(toSummary)
      const current = response.devices.find((device) => device.installationId === this.#installationId)
      if (current) await this.#identityLink(current)
      this.#publish(current
        ? current.status === 'revoked'
          ? { state: 'revoked', device: toSummary(current) }
          : { state: 'active', device: toSummary(current) }
        : { state: 'not-enrolled' })
      return { ok: true, status: this.#status, devices: this.listDevices() as DesktopDeviceSummary[] }
    } catch (error) {
      return this.#failure(error)
    }
  }

  async revoke(deviceId: string): Promise<DesktopDeviceActionResult> {
    try {
      await this.#client.revokeDevice(this.#accessContext(), {
        deviceId,
        idempotencyKey: desktopIdempotencyKey('device-revoke')
      })
      return await this.refresh()
    } catch (error) {
      return this.#failure(error)
    }
  }

  close(): void {
    this.#disposeIdentitySubscription()
    this.#listeners.clear()
  }

  async #performEnrollment(): Promise<DesktopDeviceActionResult> {
    if (this.#identity.getStatus().state !== 'signed-in') {
      this.#publish({ state: 'signed-out' })
      return { ok: false, status: this.#status, devices: [], message: 'Sign in before registering this Desktop.' }
    }
    this.#publish({ state: 'enrolling' })
    try {
      const context = this.#accessContext()
      const listed = await this.#client.listDevices(context)
      this.#devices = listed.devices.map(toSummary)
      const existing = listed.devices.find((device) => device.installationId === this.#installationId)
      if (existing?.status === 'active') {
        await this.#identityLink(existing)
        this.#publish({ state: 'active', device: toSummary(existing) })
        return { ok: true, status: this.#status, devices: this.listDevices() as DesktopDeviceSummary[] }
      }
      if (existing?.status === 'revoked') {
        await this.#identityLink(existing)
        this.#publish({ state: 'revoked', device: toSummary(existing) })
        return {
          ok: false,
          status: this.#status,
          devices: this.listDevices() as DesktopDeviceSummary[],
          message: 'This Desktop was revoked. Re-enrollment requires an explicit cloud recovery flow.'
        }
      }

      const identity = this.#identity.getStatus()
      if (identity.state !== 'signed-in') {
        throw new Error('The SciForge Cloud user is unavailable during Device enrollment.')
      }
      const key = await this.#loadOrCreateKey()
      const challenge = await this.#client.createDeviceEnrollment(context, {
        installationId: this.#installationId,
        idempotencyKey: desktopIdempotencyKey('device-enrollment')
      })
      const signature = sign(
        null,
        canonicalDeviceEnrollmentBytes({
          enrollmentId: challenge.enrollmentId,
          nonce: challenge.nonce,
          userId: identity.user.userId,
          installationId: this.#installationId,
          expiresAt: challenge.expiresAt
        }),
        createPrivateKey({ key: key.privateKey, format: 'jwk' })
      ).toString('base64url')
      const device = await this.#client.createDevice(context, {
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
      await this.refresh()
      this.#publish({ state: 'active', device: toSummary(device) })
      return { ok: true, status: this.#status, devices: this.listDevices() as DesktopDeviceSummary[] }
    } catch (error) {
      return this.#failure(error)
    }
  }

  #accessContext(): IdentityAccessContext {
    const accessToken = this.#identity.getAccessToken()
    if (!accessToken) throw new Error('The SciForge Cloud access token is unavailable.')
    return { accessToken }
  }

  async #loadOrCreateKey(): Promise<{ publicKey: Ed25519PublicJwk; privateKey: CryptoJsonWebKey }> {
    if (this.#encryption.state() !== 'available') {
      throw new Error('Secure operating-system storage is unavailable for the Desktop private key.')
    }
    const existing = await readFile(this.#keyPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (existing) {
      const stored = JSON.parse(existing) as StoredDeviceKey
      if (stored.version !== 1) throw new Error('The stored Desktop key has an unsupported version.')
      const publicKey = ed25519PublicJwkSchema.parse(stored.publicKey)
      const privateKey = JSON.parse(
        this.#encryption.decryptString(Buffer.from(stored.encryptedPrivateKey, 'base64'))
      ) as CryptoJsonWebKey
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
    const encryptedPrivateKey = this.#encryption.encryptString(JSON.stringify(privateKey)).toString('base64')
    await atomicWriteFile(this.#keyPath, JSON.stringify({ version: 1, publicKey, encryptedPrivateKey }))
    if (process.platform !== 'win32') await chmod(this.#keyPath, 0o600)
    return { publicKey, privateKey }
  }

  #handleIdentityStatus(status: DesktopIdentityStatus): void {
    if (status.state === 'signed-out') {
      this.#devices = []
      this.#publish({ state: 'signed-out' })
      return
    }
    this.#publish({ state: 'not-enrolled' })
    void this.ensureRegistered()
  }

  #failure(error: unknown): DesktopDeviceActionResult {
    const message = error instanceof Error ? error.message : 'Desktop device registration failed.'
    this.#publish({ state: 'error', message })
    return { ok: false, status: this.#status, devices: this.listDevices() as DesktopDeviceSummary[], message }
  }

  async #identityLink(device: Device): Promise<void> {
    await this.#linkDevice?.(device)
  }

  #publish(status: DesktopDeviceStatus): void {
    this.#status = status
    for (const listener of this.#listeners) {
      try {
        listener(status)
      } catch {
        // Device status observers cannot interrupt enrollment transitions.
      }
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
