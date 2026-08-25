#!/usr/bin/env node

import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const skipUnsupported = process.argv.slice(2).includes('--skip-unsupported')
if (process.platform !== 'darwin' && !skipUnsupported) {
  throw new Error('The OpenContent native enrollment addon can only be staged on macOS.')
}

if (process.platform === 'darwin') {
  const sourceRoot = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(sourceRoot, '../../../..')
  const workspaceRoot = resolve(packageRoot, '../../..')
  const binaryName = 'opencontent_native_enrollment.node'
  const sourcePath = join(sourceRoot, 'build', 'Release', binaryName)

  const source = statSync(sourcePath)
  if (!source.isFile() || source.size < 1) {
    throw new Error('The built OpenContent native enrollment addon is unavailable.')
  }

  // electron-vite bundles Domain main code into out/main/index.js and preserves
  // the static URL relative to that bundle. Electron Builder already copies and
  // unpacks out/main, so this is the single source and packaged runtime path.
  const outputDirectory = join(workspaceRoot, 'out', 'main', 'native', 'build', 'Release')
  mkdirSync(outputDirectory, { recursive: true })
  copyFileSync(sourcePath, join(outputDirectory, binaryName))
}
