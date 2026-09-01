#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  locatePackagedExecutable,
  parseSmokeCliOptions,
  runElectronDomainSmoke
} from './electron-domain-smoke-support.mjs'

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const options = parseSmokeCliOptions(process.argv.slice(2))
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const executablePath = options.executablePath ?? await locatePackagedExecutable({
    distDirectory: options.distDirectory ?? join(repositoryRoot, 'dist'),
    productName: rootPackage.productName
  })
  const result = await runElectronDomainSmoke({
    executablePath,
    expectedDeployment: options.expectedDeployment,
    label: 'packaged/unpacked',
    timeoutMs: options.timeoutMs
  })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`[electron-domain-packaged-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
