#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const skipUnsupported = process.argv.slice(2).includes('--skip-unsupported')
if (process.platform !== 'darwin' && !skipUnsupported) {
  throw new Error('The Identity private vault addon can only be built on macOS.')
}

if (process.platform === 'darwin') {
  const sourceRoot = dirname(fileURLToPath(import.meta.url))
  const outputDirectory = join(sourceRoot, 'build', 'Release')
  const nodeRoot = resolve(dirname(process.execPath), '..')
  const nodeInclude = realpathSync(join(nodeRoot, 'include', 'node'))
  mkdirSync(outputDirectory, { recursive: true })
  const result = spawnSync('xcrun', [
    '--sdk', 'macosx',
    'clang++',
    '-std=c++20',
    '-fobjc-arc',
    '-fvisibility=hidden',
    '-DNAPI_VERSION=8',
    '-mmacosx-version-min=11.0',
    '-arch', 'arm64',
    '-arch', 'x86_64',
    '-I', nodeInclude,
    '-bundle',
    '-undefined', 'dynamic_lookup',
    '-framework', 'Foundation',
    '-framework', 'Security',
    join(sourceRoot, 'identity_private_vault.mm'),
    '-o', join(outputDirectory, 'identity_private_vault.node')
  ], {
    cwd: sourceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    throw new Error('The Identity private vault addon did not compile.')
  }
}

