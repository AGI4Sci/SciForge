#!/usr/bin/env node

const { resolve } = require('node:path')

const PROJECT_ROOT = resolve(__dirname, '..')

function assertPublicReleaseCompositionEmpty(composition) {
  if (!composition || !Array.isArray(composition.packagedRuntimes)) {
    throw new TypeError('Public release guard requires canonical packagedRuntimes composition.')
  }
  const packageNames = composition.packagedRuntimes.map((runtime, index) => {
    if (!runtime || typeof runtime.packageName !== 'string' || !runtime.packageName.trim()) {
      throw new TypeError(`Internal runtime composition entry ${index} has no packageName.`)
    }
    return runtime.packageName.trim()
  }).sort()
  if (packageNames.length > 0) {
    throw new Error(
      '[public-release] Refusing to build or publish an official release while internal ' +
      `runtime composition is non-empty: ${packageNames.join(', ')}. ` +
      'Remove the internal overlay and regenerate composition before releasing.'
    )
  }
  return Object.freeze({ internalRuntimeCount: 0 })
}

function runPublicReleaseGuard(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error('Public release guard does not accept arguments or override flags.')
  }
  const projectRoot = resolve(options.projectRoot || PROJECT_ROOT)
  const createComposition = options.createComposition || defaultCreateComposition
  return assertPublicReleaseCompositionEmpty(createComposition(projectRoot))
}

function defaultCreateComposition(projectRoot) {
  const { createInternalRuntimeComposition } = require('./internal-runtime-packaging.cjs')
  return createInternalRuntimeComposition(projectRoot)
}

module.exports = {
  assertPublicReleaseCompositionEmpty,
  runPublicReleaseGuard
}

if (require.main === module) {
  try {
    const result = runPublicReleaseGuard(process.argv.slice(2))
    process.stdout.write(
      `[public-release] Internal runtime composition is empty (${result.internalRuntimeCount}).\n`
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
