import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const nativeSourceUrl = new URL(
  './native/opencontent_native_enrollment.mm',
  import.meta.url
)
const loaderSourceUrl = new URL('./native-binding.ts', import.meta.url)
const runtimeSourceUrl = new URL('./index.ts', import.meta.url)
const stageSourceUrl = new URL('./native/stage-addon.mjs', import.meta.url)

describe('OpenContent native enrollment boundary', () => {
  it('uses in-process stable Node-API, AppKit, and the device-only Keychain class', async () => {
    const source = await readFile(nativeSourceUrl, 'utf8')

    expect(source).toContain('#include <node_api.h>')
    expect(source).toContain('NAPI_MODULE_INIT()')
    expect(source).toContain('#import <AppKit/AppKit.h>')
    expect(source).toContain('#import <Security/Security.h>')
    expect(source).toContain('kSecClassGenericPassword')
    expect(source).toContain('kSecAttrAccessibleWhenUnlockedThisDeviceOnly')
    expect(source).toContain('kSecAttrSynchronizable: @NO')
    expect(source).toContain('memset_s')
    expect(source).toContain('kPromptTimeoutSeconds = 120.0')
    expect(source).toContain('NSModalPanelRunLoopMode')
  })

  it('serializes enrollment and applies a global network timeout after the modal prompt', async () => {
    const source = await readFile(runtimeSourceUrl, 'utf8')

    expect(source).toContain('let enrollmentActive = false')
    expect(source).toContain('ENROLLMENT_NETWORK_TIMEOUT_MS = 60_000')
    expect(source).toContain('AbortSignal.timeout(ENROLLMENT_NETWORK_TIMEOUT_MS)')
    expect(source).toContain("'conflict'")
  })

  it('contains no logging, process, environment, IPC, or renderer escape path', async () => {
    const [nativeSource, loaderSource] = await Promise.all([
      readFile(nativeSourceUrl, 'utf8'),
      readFile(loaderSourceUrl, 'utf8')
    ])
    const runtimeSource = `${nativeSource}\n${loaderSource}`

    for (const forbidden of [
      'NSLog',
      'printf(',
      'fprintf(',
      'std::cout',
      'std::cerr',
      'popen(',
      'system(',
      'child_process',
      'process.env',
      'electron',
      'ipcMain',
      'ipcRenderer',
      '@renderer',
      '@shared'
    ]) {
      expect(runtimeSource).not.toContain(forbidden)
    }
  })

  it('stages the addon at the one URL retained by the Electron main bundle', async () => {
    const [loaderSource, stageSource] = await Promise.all([
      readFile(loaderSourceUrl, 'utf8'),
      readFile(stageSourceUrl, 'utf8')
    ])

    expect(loaderSource).toContain(
      "'./native/build/Release/opencontent_native_enrollment.node'"
    )
    expect(stageSource).toContain(
      "'out', 'main', 'native', 'build', 'Release'"
    )
    expect(stageSource).not.toContain('process.env')
    expect(stageSource).not.toContain('child_process')
  })
})
