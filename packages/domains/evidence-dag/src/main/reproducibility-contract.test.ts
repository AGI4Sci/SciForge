import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk'
import {
  canonicalizeReproValue,
  canonicalizeReproSpecForDigest,
  sciforgeReproSpecSchema
} from '@sciforge/domain-sdk/reproducibility'

test('Python Evidence export validates and hashes identically under the shared SDK contract', () => {
  const script = fileURLToPath(new URL('../../tests/emit_shared_spec.py', import.meta.url))
  const result = spawnSync(process.env.PYTHON ?? 'python3', [script], {
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  const spec = sciforgeReproSpecSchema.parse(JSON.parse(result.stdout))
  const digest = `sha256:${createHash('sha256')
    .update(canonicalizeReproSpecForDigest(spec))
    .digest('hex')}`
  assert.equal(spec.specDigest, digest)
  assert.equal(spec.source.conclusionId, spec.target.id)
})

test('Node JSON numbers retain ECMAScript binary64 canonicalization in Python', () => {
  const script = fileURLToPath(new URL('../../tests/canonicalize_shared_value.py', import.meta.url))
  // The third token is deliberately 2^53 + 1. JSON.parse rounds it exactly as
  // the SDK runtime does before JSON.stringify crosses the process boundary.
  const values = domainPackageJsonValueSchema.parse(JSON.parse(
    '[100000000000000000000,9007199254740992,9007199254740993,5e-324,0.000001,1e-7,1e21,1.7976931348623157e308]'
  ))
  const result = spawnSync(process.env.PYTHON ?? 'python3', [script], {
    encoding: 'utf8',
    input: JSON.stringify(values)
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), canonicalizeReproValue(values))
})
