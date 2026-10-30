import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EvidenceDeltaChain, digest } from './evidence-delta.js'

const pythonSource = fileURLToPath(new URL('../../python', import.meta.url))
const python = process.env.EVIDENCE_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')

function validate(payload: Record<string, unknown>) {
  const chain = new EvidenceDeltaChain('canonical-thread')
  const delta = chain.append({
    scope: { runtimeId: 'test', threadId: 'canonical-thread', operationId: 'op', kind: 'turn', workspaceRoot: '/canonical' },
    requestedWatermark: '1', committedWatermark: '1', schemaVersion: 'evidence.delta.v1',
    extractorVersion: 'extractor-1', verifierVersion: 'verifier-1', idempotencyKey: 'canonical-replay',
    sourceRefs: [], artifactRefs: [], runRefs: [], payload, createdAt: '2026-09-01T00:00:00.000Z'
  }).delta
  const envelope = { kind: 'sciforge.evidence-delta-envelope.v1', schemaVersion: 'sciforge.evidence-delta-envelope.v1', delta }
  const child = spawnSync(python, ['-c', `
import copy, hashlib, json, sys
sys.path.insert(0, sys.argv[1])
from evidence_dag.service import _valid_evidence_delta_envelope
item = json.load(sys.stdin)
results = [_valid_evidence_delta_envelope(item)]
for field, value in [('payload', {'changed': True}), ('createdAt', '2026-09-02T00:00:00.000Z'), ('payloadDigest', 'sha256:' + '0' * 64), ('deltaDigest', 'sha256:' + '0' * 64)]:
    changed = copy.deepcopy(item)
    changed['delta'][field] = value
    results.append(_valid_evidence_delta_envelope(changed))
# Reject alternate Python-only identities: no dual-canonical fallback.
try:
    legacy = copy.deepcopy(item)
    def old_digest(value):
        return 'sha256:' + hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
    legacy['delta']['payloadDigest'] = old_digest(legacy['delta']['payload'])
    legacy['delta']['deltaDigest'] = old_digest({k: v for k, v in legacy['delta'].items() if k != 'deltaDigest'})
    assert _valid_evidence_delta_envelope(legacy) == (legacy == item)
except UnicodeError:
    pass  # Python's former UTF-8 encoder could not produce this identity.
for number in [float('nan'), float('inf'), -float('inf')]:
    changed = copy.deepcopy(item)
    changed['delta']['payload'] = {'value': number}
    assert not _valid_evidence_delta_envelope(changed)
print(json.dumps(results))
`, pythonSource], { input: JSON.stringify(envelope), encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout), [true, false, false, false, false])
  // The fix must not re-key existing TS deltas, including after a wire roundtrip.
  assert.equal(digest(JSON.parse(JSON.stringify(payload))), delta.payloadDigest)
}

describe('TS immutable delta → actual Python envelope validator', () => {
  for (const [label, payload] of [
    ['historically compatible decimal', { value: 0.9 }],
    ['fixed small decimal', { value: 0.00001 }],
    ['negative exponent', { value: 1e-7 }],
    ['JS signed zero and integral floats', { values: [-0, 0, 1, -1, 1000000000000000100] }],
    ['exponent boundaries', { values: [1e-6, 1e-7, 1e20, 1e21, 1e23, -1e-6, -1e21] }],
    ['binary64 extrema', { values: [Number.MIN_VALUE, Number.MAX_VALUE, Number.EPSILON, 2.2250738585072014e-308] }],
    ['nested floats and UTF-16 ordering', { '\ue000': 1e-7, '😀': { z: [0.00001, { '10': 1e21, '2': -0 }], a: '汉字\u2028\u0000"\\' } }],
    ['lone surrogates', { '\ud800': '\udfff', text: '😀' }]
  ] as const) it(label, () => validate(payload))

  it('matches TS digests for 4096 deterministic finite binary64 bit patterns', () => {
    let state = 0x4d595df4d0f33173n
    const view = new DataView(new ArrayBuffer(8))
    const values: number[] = []
    while (values.length < 4096) {
      state ^= state << 13n
      state ^= state >> 7n
      state ^= state << 17n
      state = BigInt.asUintN(64, state)
      view.setBigUint64(0, state)
      const value = view.getFloat64(0)
      if (Number.isFinite(value)) values.push(value)
    }
    validate({ values })
  })
})
