import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDshShimLaunch } from '../src/transport.js'

const SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
  ''
].join('\r\n')

const shimPath = 'C:\\Users\\tester\\AppData\\Roaming\\npm\\dsh.cmd'
const entryPath = 'C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'

test('resolves an npm .cmd shim into interpreter plus entry script', () => {
  const launch = resolveDshShimLaunch(shimPath, ['acp', '--dump-config'], {
    platform: 'win32',
    parentPath: 'C:\\Program Files\\nodejs',
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    exists: (path) => path === entryPath || path === 'C:\\Program Files\\nodejs\\node.exe',
    readText: () => SHIM
  })
  assert.deepEqual(launch, {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    args: [entryPath, 'acp', '--dump-config'],
    electronRunAsNode: false
  })
})

test('prefers a node.exe that sits beside the shim', () => {
  const launch = resolveDshShimLaunch(shimPath, [], {
    platform: 'win32',
    parentPath: 'C:\\Program Files\\nodejs',
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    exists: (path) => path === entryPath || path === 'C:\\Users\\tester\\AppData\\Roaming\\npm\\node.exe',
    readText: () => SHIM
  })
  assert.equal(launch?.command, 'C:\\Users\\tester\\AppData\\Roaming\\npm\\node.exe')
})

test('falls back to the packaged Electron binary as the interpreter', () => {
  const launch = resolveDshShimLaunch(shimPath, [], {
    platform: 'win32',
    parentPath: '',
    execPath: 'E:\\desktop\\SciForgeApp\\SciForge.exe',
    exists: (path) => path === entryPath || path === 'E:\\desktop\\SciForgeApp\\SciForge.exe',
    readText: () => SHIM
  })
  assert.equal(launch?.command, 'E:\\desktop\\SciForgeApp\\SciForge.exe')
  assert.equal(launch?.electronRunAsNode, true)
})

test('a missing entry script or interpreter is not silently accepted', () => {
  assert.equal(
    resolveDshShimLaunch(shimPath, [], {
      platform: 'win32',
      exists: () => false,
      readText: () => SHIM
    }),
    undefined
  )
  assert.throws(
    () =>
      resolveDshShimLaunch(shimPath, [], {
        platform: 'win32',
        parentPath: '',
        execPath: 'C:\\missing\\electron.exe',
        exists: (path) => path === entryPath,
        readText: () => SHIM
      }),
    /runtime_interpreter_missing/u
  )
})

test('non-shim executables are left to the cmd.exe resolver', () => {
  assert.equal(resolveDshShimLaunch('C:\\tools\\dsh.exe', [], { platform: 'win32' }), undefined)
  assert.equal(resolveDshShimLaunch(shimPath, [], { platform: 'darwin' }), undefined)
})
