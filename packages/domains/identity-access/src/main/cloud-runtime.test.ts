import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalCloudIdentityLinkService } from './cloud-link-service.js'
import { resolveDesktopIdentityRuntimeConfig } from './cloud-runtime-config.js'
import { CloudIdentityRuntime } from './cloud-runtime.js'
import { DesktopDeviceService } from './device-service.js'
import { DesktopIdentityService } from './oidc-service.js'
import { IdentityStore } from './store.js'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CloudIdentityRuntime', () => {
  it('uses the real HTTP client only when both endpoints are explicitly configured', () => {
    expect(resolveDesktopIdentityRuntimeConfig({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })).toEqual({
      mode: 'http',
      issuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })
    expect(resolveDesktopIdentityRuntimeConfig({
      oidcIssuer: 'http://127.0.0.1:8080/realms/SciForge',
      cloudBaseUrl: 'http://localhost:8787'
    })).toEqual({
      mode: 'http',
      issuer: 'http://127.0.0.1:8080/realms/SciForge',
      cloudBaseUrl: 'http://localhost:8787'
    })
  })

  it.each([
    ['missing issuer', { SCIFORGE_CLOUD_BASE_URL: 'http://127.0.0.1:8787' }],
    ['missing Cloud URL', { SCIFORGE_OIDC_ISSUER: 'http://127.0.0.1:8080/realms/SciForge' }],
    ['both endpoints missing', {}],
    ['invalid issuer', {
      SCIFORGE_OIDC_ISSUER: 'http://identity.example.test/realms/SciForge',
      SCIFORGE_CLOUD_BASE_URL: 'http://127.0.0.1:8787'
    }],
    ['invalid Cloud URL', {
      SCIFORGE_OIDC_ISSUER: 'https://identity.example.test/realms/SciForge',
      SCIFORGE_CLOUD_BASE_URL: 'http://cloud.example.test'
    }]
  ])('fails closed without network access when %s', async (_label, environment) => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-cloud-runtime-'))
    roots.push(root)
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const runtime = await CloudIdentityRuntime.create({
      userDataDir: root,
      appRoot: root,
      appVersion: '1.0.0',
      environment,
      installationId: 'installation-1',
      privateVault: memoryVault(),
      externalNavigation: {
        issueTarget: vi.fn(() => ({
          handle: 'navigation-handle',
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        })),
        openTarget: vi.fn(async () => undefined)
      }
    })

    try {
      await expect(runtime.initialize()).resolves.toMatchObject({
        identity: { state: 'signed-out' },
        device: { state: 'signed-out' },
        error: { source: 'identity', code: 'OIDC_CONFIGURATION_ERROR' }
      })
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      runtime.close()
    }
  })

  it('keeps a projection failure visible after a successful identity action', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-cloud-runtime-'))
    roots.push(root)
    const blockedUserDataDir = join(root, 'not-a-directory')
    writeFileSync(blockedUserDataDir, 'blocked')
    const runtime = await CloudIdentityRuntime.create({
      userDataDir: blockedUserDataDir,
      appRoot: root,
      appVersion: '1.0.0',
      environment: {},
      installationId: 'installation-1',
      privateVault: memoryVault(),
      externalNavigation: {
        issueTarget: vi.fn(() => ({
          handle: 'navigation-handle',
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        })),
        openTarget: vi.fn(async () => undefined)
      }
    })

    try {
      const initialized = await runtime.initialize()
      expect(initialized.error).toMatchObject({ source: 'runtime' })
      expect(initialized.error?.message).toContain('Local cloud identity storage is unavailable')

      const afterLogout = await runtime.logout()
      expect(afterLogout.identity.state).toBe('signed-out')
      expect(afterLogout.error).toEqual(initialized.error)
    } finally {
      runtime.close()
    }
  })

  it('keeps recoverable initialization failures active for retry and cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-cloud-runtime-'))
    roots.push(root)
    const runtime = await CloudIdentityRuntime.create({
      userDataDir: root,
      appRoot: root,
      appVersion: '1.0.0',
      environment: {},
      installationId: 'installation-1',
      privateVault: memoryVault()
    })

    try {
      const initialized = await runtime.initialize()
      expect(initialized.identity.state).toBe('signed-out')
      expect(initialized.error).toMatchObject({
        source: 'identity',
        code: 'OIDC_CONFIGURATION_ERROR'
      })

      await expect(runtime.logout()).resolves.toMatchObject({
        identity: { state: 'signed-out' }
      })
      expect(runtime.snapshot().revision).toMatch(/^cloud-\d+$/)
    } finally {
      runtime.close()
    }
  })

  it('validates application metadata before opening local cloud identity storage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-cloud-runtime-'))
    roots.push(root)
    const openStore = vi.spyOn(IdentityStore, 'open')

    await expect(CloudIdentityRuntime.create({
      userDataDir: root,
      appRoot: root,
      environment: {},
      installationId: 'installation-1',
      privateVault: memoryVault()
    })).rejects.toThrow()

    expect(openStore).not.toHaveBeenCalled()
  })

  it('uses the Host version without reading package metadata from a packaged app root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-cloud-runtime-'))
    roots.push(root)
    const packagedAppRoot = join(root, 'resources', 'app.asar.unpacked')
    const runtime = await CloudIdentityRuntime.create({
      userDataDir: root,
      appRoot: packagedAppRoot,
      appVersion: '9.8.7-packaged',
      environment: {},
      installationId: 'installation-1',
      privateVault: memoryVault()
    })

    try {
      await expect(runtime.initialize()).resolves.toMatchObject({
        identity: { state: 'signed-out' },
        device: { state: 'signed-out' }
      })
    } finally {
      runtime.close()
    }
  })

  it('closes every constructed owner exactly once when runtime subscription fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-cloud-runtime-'))
    roots.push(root)
    const closeLinks = vi.spyOn(LocalCloudIdentityLinkService.prototype, 'close')
    const closeIdentity = vi.spyOn(DesktopIdentityService.prototype, 'close')
    const closeDevice = vi.spyOn(DesktopDeviceService.prototype, 'close')
    vi.spyOn(DesktopDeviceService.prototype, 'subscribe').mockImplementationOnce(() => {
      throw new Error('device subscription failed')
    })

    await expect(CloudIdentityRuntime.create({
      userDataDir: root,
      appRoot: root,
      appVersion: '1.0.0',
      environment: {},
      installationId: 'installation-1',
      privateVault: memoryVault()
    })).rejects.toThrow('device subscription failed')

    expect(closeDevice).toHaveBeenCalledOnce()
    expect(closeIdentity).toHaveBeenCalledOnce()
    expect(closeLinks).toHaveBeenCalledOnce()
  })
})

function memoryVault() {
  const values = new Map<string, string>()
  const key = (ref: Readonly<{ kind: string; agentId?: string }>) =>
    `${ref.kind}:${ref.agentId ?? ''}`
  return {
    has: async (ref: Readonly<{ kind: string; agentId?: string }>) => values.has(key(ref)),
    read: async (ref: Readonly<{ kind: string; agentId?: string }>) => values.get(key(ref)) ?? null,
    write: async (ref: Readonly<{ kind: string; agentId?: string }>, value: string) => {
      values.set(key(ref), value)
    },
    remove: async (ref: Readonly<{ kind: string; agentId?: string }>) => {
      values.delete(key(ref))
    }
  }
}
