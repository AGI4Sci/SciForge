import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveElectronRunAsNodeExecutable } from './electron-node-executable.js'

test('uses the packaged macOS Helper executable', () => {
  assert.equal(
    resolveElectronRunAsNodeExecutable(
      '/Applications/SciForge.app/Contents/MacOS/SciForge',
      'darwin'
    ),
    '/Applications/SciForge.app/Contents/Frameworks/SciForge Helper.app/Contents/MacOS/SciForge Helper'
  )
})

test('keeps a non-bundle macOS executable unchanged', () => {
  assert.equal(
    resolveElectronRunAsNodeExecutable('/opt/sciforge/electron', 'darwin'),
    '/opt/sciforge/electron'
  )
})

test('uses the application executable directly on Windows', () => {
  assert.equal(
    resolveElectronRunAsNodeExecutable(
      String.raw`C:\Program Files\SciForge\SciForge.exe`,
      'win32'
    ),
    String.raw`C:\Program Files\SciForge\SciForge.exe`
  )
})

test('uses the application executable directly on Linux', () => {
  assert.equal(
    resolveElectronRunAsNodeExecutable('/opt/SciForge/sciforge', 'linux'),
    '/opt/SciForge/sciforge'
  )
})
