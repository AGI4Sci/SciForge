#!/usr/bin/env node

const { runConfiguredPublicReleaseGuard } = require('./public-release-guard.cjs')

runConfiguredPublicReleaseGuard().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
