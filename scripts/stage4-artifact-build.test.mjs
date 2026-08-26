import assert from 'node:assert/strict'
import test from 'node:test'

import { parseStage4ArtifactBuildOptions } from './stage4-artifact-build.mjs'

test('accepts explicit absolute private domain package inputs', () => {
  assert.deepEqual(
    parseStage4ArtifactBuildOptions([
      '--platform',
      'mac',
      '--architecture',
      'arm64',
      '--private-domain-package',
      '/private/stage4/authorization-a',
      '--private-domain-package',
      '/private/stage4/authorization-b'
    ]),
    {
      architecture: 'arm64',
      platform: 'mac',
      privateDomainPackagePaths: [
        '/private/stage4/authorization-a',
        '/private/stage4/authorization-b'
      ]
    }
  )
})

test('rejects relative private domain package inputs at the builder boundary', () => {
  assert.throws(
    () => parseStage4ArtifactBuildOptions([
      '--platform',
      'mac',
      '--architecture',
      'arm64',
      '--private-domain-package',
      './private-authorization'
    ]),
    /private domain package path must be absolute/u
  )
})

test('fails closed at the public builder boundary when no private package is provided', () => {
  assert.throws(
    () => parseStage4ArtifactBuildOptions([
      '--platform',
      'mac',
      '--architecture',
      'arm64'
    ]),
    /requires a reviewed private Content Space verification-profile contribution/u
  )
})
