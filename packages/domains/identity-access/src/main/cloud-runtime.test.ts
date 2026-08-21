import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalCloudIdentityLinkService } from './cloud-link-service.js'
import { CloudIdentityRuntime } from './cloud-runtime.js'
import { DesktopDeviceService } from './device-service.js'
import { DesktopIdentityService } from './oidc-service.js'
import { IdentityStore } from './store.js'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CloudIdentityRuntime', () => {
  it('keeps a projection failure visible after a successful identity action', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-cloud-runtime-'))
    roots.push(root)
    const blockedUserDataDir = join(root, 'not-a-directory')
    writeFileSync(blockedUserDataDir, 'blocked')
    const runtime = await CloudIdentityRuntime.create({
      userDataDir: blockedUserDataDir,
      appRoot: root,
      appVersion: '1.0.0',
      isPackaged: false,
      environment: {},
      installationId: 'installation-1',
      packageSecrets: memorySecrets(),
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
      isPackaged: false,
      environment: {},
      installationId: 'installation-1',
      packageSecrets: memorySecrets()
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
      isPackaged: false,
      environment: {},
      installationId: 'installation-1',
      packageSecrets: memorySecrets()
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
      isPackaged: true,
      environment: {},
      installationId: 'installation-1',
      packageSecrets: memorySecrets()
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
      isPackaged: false,
      environment: {},
      installationId: 'installation-1',
      packageSecrets: memorySecrets()
    })).rejects.toThrow('device subscription failed')

    expect(closeDevice).toHaveBeenCalledOnce()
    expect(closeIdentity).toHaveBeenCalledOnce()
    expect(closeLinks).toHaveBeenCalledOnce()
  })
})

function memorySecrets() {
  const values = new Map<string, string>()
  return {
    has: async (key: string) => values.has(key),
    read: async (key: string) => values.get(key) ?? null,
    write: async (key: string, value: string) => {
      values.set(key, value)
    },
    remove: async (key: string) => {
      values.delete(key)
    }
  }
}
