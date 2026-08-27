#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const skipUnsupported = process.argv.slice(2).includes('--skip-unsupported')

if (process.platform !== 'darwin' && !skipUnsupported) {
  throw new Error('The OpenContent native enrollment addon can only be built on macOS.')
}

if (process.platform === 'darwin') {
  const sourceRoot = dirname(fileURLToPath(import.meta.url))
  const outputDirectory = join(sourceRoot, 'build', 'Release')
  const outputPath = join(outputDirectory, 'opencontent_native_enrollment.node')
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
    '-framework', 'AppKit',
    '-framework', 'Foundation',
    '-framework', 'Security',
    join(sourceRoot, 'opencontent_native_enrollment.mm'),
    '-o', outputPath
  ], {
    cwd: sourceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (result.status !== 0) {
    throw new Error('The OpenContent native enrollment addon did not compile.')
  }
}
