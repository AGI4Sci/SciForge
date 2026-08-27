#!/usr/bin/env node

import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSourceSmokeConfiguration,
  parseSmokeCliOptions,
  runElectronDomainSmoke
} from './electron-domain-smoke-support.mjs'

const require = createRequire(import.meta.url)
const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const options = parseSmokeCliOptions(process.argv.slice(2))
  if (options.distDirectory || options.executablePath) {
    throw new Error('The source/out smoke only accepts --repository-root and --timeout-ms.')
  }
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot
  const configuration = await createSourceSmokeConfiguration(repositoryRoot)
  const result = await runElectronDomainSmoke({
    executablePath: require('electron'),
    ...configuration,
    expectedDeployment: options.expectedDeployment,
    timeoutMs: options.timeoutMs
  })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`[electron-domain-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
