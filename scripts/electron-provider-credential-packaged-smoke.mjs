#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { locatePackagedExecutable } from './electron-domain-smoke-support.mjs'
import {
  parseProviderCredentialSmokeCli,
  runProviderCredentialElectronSmoke
} from './electron-provider-credential-smoke-support.mjs'

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const options = parseProviderCredentialSmokeCli(process.argv.slice(2))
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const executablePath = options.executablePath ?? await locatePackagedExecutable({
    distDirectory: options.distDirectory ?? join(repositoryRoot, 'dist'),
    productName: rootPackage.productName
  })
  const result = await runProviderCredentialElectronSmoke({
    executablePath,
    label: 'packaged-app',
    timeoutMs: options.timeoutMs
  })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`[electron-provider-credential-packaged-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
