#!/usr/bin/env node

import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseProviderCredentialSmokeCli,
  runProviderCredentialElectronSmoke
} from './electron-provider-credential-smoke-support.mjs'

const require = createRequire(import.meta.url)
const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const options = parseProviderCredentialSmokeCli(process.argv.slice(2))
  if (options.distDirectory || options.executablePath) {
    throw new Error('The source provider credential smoke accepts only --repository-root and --timeout-ms.')
  }
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot
  const result = await runProviderCredentialElectronSmoke({
    executablePath: require('electron'),
    applicationPath: repositoryRoot,
    label: 'source/out',
    timeoutMs: options.timeoutMs
  })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`[electron-provider-credential-source-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
