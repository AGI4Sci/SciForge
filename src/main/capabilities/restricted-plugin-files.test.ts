import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createRestrictedPluginFileAuthority, PluginFileServiceError } from './restricted-plugin-files'

// macOS TMPDIR ends with a trailing slash; join() keeps the lexical contract
// canonical (normalize(profileRoot) === profileRoot) regardless of platform.
const neutralProfileRoot = join(process.env.TMPDIR ?? tmpdir(), 'neutral-profile')

const facts = { callerId: 'neutral-caller', sessionId: 'neutral-session', invocationId: 'neutral-invocation',
  packageName: 'neutral-plugin', packageVersion: '1.0.0', generation: 'neutral-generation' }
function fixture() {
  const invocation = Object.freeze({ ...facts })
  const authority = createRestrictedPluginFileAuthority({
    profileRoot: neutralProfileRoot, packageName: facts.packageName,
    packageVersion: facts.packageVersion, generation: facts.generation,
    maxFileBytes: 4, maxInvocationBytes: 6,
    authenticate: (snapshot: object) => snapshot === invocation ? facts : undefined
  })
  return { authority, invocation }
}

it.each(['read', 'write', 'delete'] as const)('%s fails closed without a race-safe executor', async (operation) => {
  const { authority, invocation } = fixture()
  const grant = authority.issueGrant(invocation)
  const call = operation === 'read' ? authority.files.read(grant, invocation, 'entry', 4)
    : operation === 'write' ? authority.files.write(grant, invocation, 'entry', new Uint8Array([1]))
      : authority.files.delete(grant, invocation, 'entry')
  await expect(call).rejects.toMatchObject({ code: 'file_service_blocked', reason: 'descriptor_relative_executor_unavailable' })
})

it('rejects self-asserted invocation identity at grant issuance', () => {
  const { authority } = fixture()
  expect(() => authority.issueGrant(Object.freeze({ ...facts }))).toThrowError(expect.objectContaining({ code: 'file_access_denied' }))
})

it.each(['forged', 'copied', 'other-authority', 'other-session'] as const)('rejects %s grants before file admission', async (kind) => {
  const { authority, invocation } = fixture()
  const issued = authority.issueGrant(invocation)
  const other = fixture()
  const grant = kind === 'forged' ? {} : kind === 'copied' ? { ...issued } : kind === 'other-authority'
    ? other.authority.issueGrant(other.invocation) : issued
  const target = kind === 'other-session' ? Object.freeze({ ...facts, sessionId: 'foreign' }) : invocation
  await expect(authority.files.delete(grant, target, 'entry')).rejects.toMatchObject({ code: 'file_access_denied' })
})

it.each(['callerId', 'sessionId', 'invocationId', 'packageName', 'packageVersion', 'generation'] as const)(
  'rejects stale authenticated %s facts on an existing grant', async (field) => {
    const current = { ...facts }
    const invocation = Object.freeze({ context: { turn: 'neutral' } })
    const authority = createRestrictedPluginFileAuthority({
      profileRoot: neutralProfileRoot, ...facts,
      maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => current
    })
    const grant = authority.issueGrant(invocation)
    current[field] = 'foreign'
    await expect(authority.files.delete(grant, invocation, 'entry')).rejects.toMatchObject({ code: 'file_access_denied' })
  }
)

it.each(['packageName', 'packageVersion', 'generation'] as const)('rejects mismatching Host %s at issuance', (field) => {
  const authority = createRestrictedPluginFileAuthority({
    profileRoot: neutralProfileRoot, ...facts, maxFileBytes: 4, maxInvocationBytes: 6,
    authenticate: () => ({ ...facts, [field]: 'foreign' })
  })
  expect(() => authority.issueGrant({})).toThrowError(expect.objectContaining({ code: 'file_access_denied' }))
})

it.each(['/absolute', '../outside', 'a/../outside', 'a/./b', '.', '', 'a//b', 'C:\\outside', 'a\\b', 'a\u0000b'])(
  'rejects noncanonical relative path %j', async (path) => {
    const { authority, invocation } = fixture()
    const grant = authority.issueGrant(invocation)
    await expect(authority.files.delete(grant, invocation, path)).rejects.toMatchObject({ code: 'file_path_invalid' })
  }
)

it.each([5, -1, NaN, Infinity, 1.5])('rejects invalid read byte reservation %j', async (size) => {
  const { authority, invocation } = fixture()
  await expect(authority.files.read(authority.issueGrant(invocation), invocation, 'entry', size))
    .rejects.toMatchObject({ code: 'file_size_limit' })
})
it('rejects oversized write bytes', async () => {
  const { authority, invocation } = fixture()
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', new Uint8Array(5)))
    .rejects.toMatchObject({ code: 'file_size_limit' })
})
it.each(['value', 'getter'] as const)('uses intrinsic write length for the file quota despite an own %s', async (kind) => {
  const { authority, invocation } = fixture()
  const bytes = new Uint8Array(5)
  Object.defineProperty(bytes, 'byteLength', kind === 'value' ? { value: 0 }
    : { get: () => { throw new Error('private-length-detail') } })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', bytes))
    .rejects.toMatchObject({ code: 'file_size_limit' })
})

it('uses intrinsic write length for the aggregate invocation quota', async () => {
  const { authority, invocation } = fixture()
  const bytes = new Uint8Array(4)
  Object.defineProperty(bytes, 'byteLength', { value: 0 })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', bytes))
    .rejects.toMatchObject({ code: 'file_service_blocked' })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', new Uint8Array(3)))
    .rejects.toMatchObject({ code: 'file_size_limit' })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', new Uint8Array(2)))
    .rejects.toMatchObject({ code: 'file_service_blocked' })
})

it('bounds aggregate attempted bytes across grants for one authenticated snapshot', async () => {
  const { authority, invocation } = fixture()
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', new Uint8Array(4)))
    .rejects.toMatchObject({ code: 'file_service_blocked' })
  await expect(authority.files.read(authority.issueGrant(invocation), invocation, 'entry', 3))
    .rejects.toMatchObject({ code: 'file_size_limit' })
  await expect(authority.files.read(authority.issueGrant(invocation), invocation, 'entry', 2))
    .rejects.toMatchObject({ code: 'file_service_blocked' })
})

it.each(['read', 'write', 'delete'] as const)('checks live AbortSignal before %s admission', async (operation) => {
  const controller = new AbortController()
  const invocation = Object.freeze({ ...facts })
  const authority = createRestrictedPluginFileAuthority({
    profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => ({ ...facts, signal: controller.signal })
  })
  const grant = authority.issueGrant(invocation)
  controller.abort()
  const call = operation === 'read' ? authority.files.read(grant, invocation, 'entry', 4)
    : operation === 'write' ? authority.files.write(grant, invocation, 'entry', new Uint8Array(4))
      : authority.files.delete(grant, invocation, 'entry')
  await expect(call).rejects.toMatchObject({ code: 'file_cancelled' })
})

it.each(['relative', '', '/a/../b', '/a/./b', '/a//b', '/a/', '/a\u0000b'])(
  'rejects invalid authority root %j at grant issuance', (profileRoot) => {
    const authority = createRestrictedPluginFileAuthority({ profileRoot, ...facts,
      maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => facts })
    expect(() => authority.issueGrant({})).toThrowError(expect.objectContaining({ code: 'file_contract_invalid' }))
  }
)
it('validates authority roots using native platform separators', async () => {
  const authority = createRestrictedPluginFileAuthority({ profileRoot: '/a\\b', ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => facts })
  if (process.platform === 'win32') {
    expect(() => authority.issueGrant({})).toThrowError(expect.objectContaining({ code: 'file_contract_invalid' }))
  } else {
    // Backslashes are ordinary POSIX filename bytes; grant issuance still opens no files.
    const invocation = {}
    const grant = authority.issueGrant(invocation)
    await expect(authority.files.delete(grant, invocation, 'entry')).rejects.toMatchObject({
      code: 'file_service_blocked', reason: 'descriptor_relative_executor_unavailable'
    })
  }
})
it('rejects a root no longer bound to the authority at issuance and operation', async () => {
  const options = { profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => facts }
  const authority = createRestrictedPluginFileAuthority(options)
  const invocation = {}
  const grant = authority.issueGrant(invocation)
  options.profileRoot = join(process.env.TMPDIR ?? tmpdir(), 'other-profile')
  expect(() => authority.issueGrant({})).toThrowError(expect.objectContaining({ code: 'file_contract_invalid' }))
  await expect(authority.files.delete(grant, invocation, 'entry')).rejects.toMatchObject({ code: 'file_contract_invalid' })
})

it.each([
  [NaN, 4], [Infinity, 4], [0, 4], [4, 0], [4, NaN], [4, Infinity], [5, 4]
])('rejects unsafe quota contract %j/%j immediately', (maxFileBytes, maxInvocationBytes) => {
  expect(() => createRestrictedPluginFileAuthority({ profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes, maxInvocationBytes, authenticate: () => facts })).toThrowError(expect.objectContaining({ code: 'file_contract_invalid' }))
})

it('normalizes authenticate exceptions to access denied without the source message', () => {
  const secret = 'sensitive-authentication-detail'
  const authority = createRestrictedPluginFileAuthority({ profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => { throw new Error(secret) } })
  expect(() => authority.issueGrant({})).toThrowError(expect.objectContaining({ code: 'file_access_denied' }))
  expect(() => authority.issueGrant({})).not.toThrow(secret)
})

it('rejects null write bytes with a structured asynchronous input error', async () => {
  const { authority, invocation } = fixture()
  const result = authority.files.write(authority.issueGrant(invocation), invocation, 'entry', null as unknown as Uint8Array)
  expect(result).toBeInstanceOf(Promise)
  await expect(result).rejects.toMatchObject({ code: 'file_input_invalid' })
})

it.each(['prototype', 'proxy', 'throwing-proxy'] as const)(
  'rejects %s Uint8Array impostors with a structured asynchronous input error', async (kind) => {
    const { authority, invocation } = fixture()
    const bytes = kind === 'prototype' ? Object.create(Uint8Array.prototype)
      : new Proxy(new Uint8Array(1), kind === 'throwing-proxy'
        ? { getPrototypeOf: () => { throw new Error('private-input-detail') } } : {})
    const result = authority.files.write(authority.issueGrant(invocation), invocation, 'entry', bytes)
    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toBeInstanceOf(PluginFileServiceError)
    await expect(result).rejects.toMatchObject({ code: 'file_input_invalid', message: 'file_input_invalid' })
  }
)

it.each(['plain', 'spoofed-tag', 'throwing-tag'] as const)(
  'rejects reparented Uint16Array bytes with %s metadata', async (kind) => {
    const { authority, invocation } = fixture()
    const bytes = new Uint16Array(1)
    Object.setPrototypeOf(bytes, Uint8Array.prototype)
    if (kind !== 'plain') Object.defineProperty(bytes, Symbol.toStringTag, kind === 'spoofed-tag'
      ? { value: 'Uint8Array' } : { get: () => { throw new Error('private-tag-detail') } })
    Object.defineProperty(bytes, 'constructor', { value: Uint8Array })
    expect(bytes).toBeInstanceOf(Uint8Array)
    const result = authority.files.write(authority.issueGrant(invocation), invocation, 'entry', bytes as unknown as Uint8Array)
    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toBeInstanceOf(PluginFileServiceError)
    await expect(result).rejects.toMatchObject({ code: 'file_input_invalid', message: 'file_input_invalid' })
    // Invalid element types must not consume an otherwise valid reservation.
    await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', new Uint8Array(4)))
      .rejects.toMatchObject({ code: 'file_service_blocked' })
    await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', new Uint8Array(2)))
      .rejects.toMatchObject({ code: 'file_service_blocked' })
  }
)

it('admits cross-realm Uint8Array bytes using intrinsic length for quotas', async () => {
  const { authority, invocation } = fixture()
  const makeBytes = (size: number): Uint8Array => runInNewContext(`new Uint8Array(${size})`)
  const bytes = makeBytes(4)
  expect(bytes).not.toBeInstanceOf(Uint8Array)
  Object.defineProperty(bytes, 'byteLength', { get: () => { throw new Error('private-length-detail') } })
  Object.defineProperty(bytes, Symbol.toStringTag, { get: () => { throw new Error('private-tag-detail') } })
  Object.defineProperty(bytes, 'constructor', { get: () => { throw new Error('private-constructor-detail') } })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', bytes))
    .rejects.toMatchObject({ code: 'file_service_blocked', reason: 'descriptor_relative_executor_unavailable' })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', makeBytes(5)))
    .rejects.toMatchObject({ code: 'file_size_limit' })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', makeBytes(3)))
    .rejects.toMatchObject({ code: 'file_size_limit' })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', makeBytes(2)))
    .rejects.toMatchObject({ code: 'file_service_blocked' })
})

it.each(['Uint8Array', 'Buffer'] as const)('preserves valid %s write admission and quota behavior', async (kind) => {
  const { authority, invocation } = fixture()
  const makeBytes = (size: number) => kind === 'Buffer' ? Buffer.alloc(size) : new Uint8Array(size)
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', makeBytes(4)))
    .rejects.toMatchObject({ code: 'file_service_blocked', reason: 'descriptor_relative_executor_unavailable' })
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', makeBytes(3)))
    .rejects.toMatchObject({ code: 'file_size_limit' })
})

it.each([
  { [Symbol.toStringTag]: 'Uint8Array', constructor: Uint8Array, byteLength: 1 },
  new Uint16Array(1), new DataView(new ArrayBuffer(1))
])('rejects non-Uint8Array input without trusting tags or constructors %#', async (bytes) => {
  const { authority, invocation } = fixture()
  await expect(authority.files.write(authority.issueGrant(invocation), invocation, 'entry', bytes as unknown as Uint8Array))
    .rejects.toMatchObject({ code: 'file_input_invalid' })
})

it('aggregates quota by authenticated identity rather than equal snapshots', async () => {
  const first = Object.freeze({ ...facts }); const second = Object.freeze({ ...facts })
  const authority = createRestrictedPluginFileAuthority({ profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: (snapshot) => snapshot === first || snapshot === second ? facts : undefined })
  await expect(authority.files.write(authority.issueGrant(first), first, 'entry', new Uint8Array(4))).rejects.toMatchObject({ code: 'file_service_blocked' })
  await expect(authority.files.read(authority.issueGrant(second), second, 'entry', 3)).rejects.toMatchObject({ code: 'file_size_limit' })
})

it('rejects a changed or missing grant-bound signal', async () => {
  const first = new AbortController(); const second = new AbortController()
  const invocation = Object.freeze({ ...facts }); let current: AbortSignal | undefined = first.signal
  const authority = createRestrictedPluginFileAuthority({ profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => ({ ...facts, signal: current }) })
  const grant = authority.issueGrant(invocation); current = second.signal
  await expect(authority.files.delete(grant, invocation, 'entry')).rejects.toMatchObject({ code: 'file_access_denied' })
  current = undefined
  await expect(authority.files.delete(grant, invocation, 'entry')).rejects.toMatchObject({ code: 'file_access_denied' })
})

it.each(['replaced-live', 'missing', 'current-aborted'] as const)(
  'checks grant-bound and current cancellation with %s signal', async (kind) => {
    const bound = new AbortController()
    const replacement = new AbortController()
    let signal: AbortSignal | undefined = bound.signal
    const invocation = {}
    const authority = createRestrictedPluginFileAuthority({ profileRoot: neutralProfileRoot, ...facts,
      maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => ({ ...facts, signal }) })
    const grant = authority.issueGrant(invocation)
    if (kind === 'current-aborted') replacement.abort()
    else bound.abort()
    signal = kind === 'missing' ? undefined : replacement.signal
    await expect(authority.files.delete(grant, invocation, 'entry')).rejects.toMatchObject({ code: 'file_cancelled' })
  }
)

it('normalizes authentication exceptions during an operation', async () => {
  let fail = false
  const invocation = {}
  const authority = createRestrictedPluginFileAuthority({ profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => {
      if (fail) throw new Error('private-auth-detail')
      return facts
    } })
  const grant = authority.issueGrant(invocation)
  fail = true
  await expect(authority.files.delete(grant, invocation, 'entry')).rejects.toMatchObject({
    code: 'file_access_denied', message: 'file_access_denied'
  })
})
it.each(['read', 'write', 'delete'] as const)('revalidates the authority root before %s', async (operation) => {
  const options = { profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6, authenticate: () => facts }
  const authority = createRestrictedPluginFileAuthority(options)
  const invocation = {}
  const grant = authority.issueGrant(invocation)
  options.profileRoot = 'relative'
  const result = operation === 'read' ? authority.files.read(grant, invocation, 'entry', 1)
    : operation === 'write' ? authority.files.write(grant, invocation, 'entry', new Uint8Array(1))
      : authority.files.delete(grant, invocation, 'entry')
  await expect(result).rejects.toMatchObject({ code: 'file_contract_invalid' })
})
it.each(['callerId', 'sessionId', 'invocationId'] as const)('keeps distinct authenticated %s quotas independent', async (field) => {
  const first = {}; const second = {}
  const authority = createRestrictedPluginFileAuthority({ profileRoot: neutralProfileRoot, ...facts,
    maxFileBytes: 4, maxInvocationBytes: 6,
    authenticate: snapshot => ({ ...facts, [field]: snapshot === first ? facts[field] : 'other-identity' }) })
  await expect(authority.files.read(authority.issueGrant(first), first, 'entry', 4)).rejects.toMatchObject({ code: 'file_service_blocked' })
  await expect(authority.files.read(authority.issueGrant(second), second, 'entry', 4)).rejects.toMatchObject({ code: 'file_service_blocked' })
})

describe('restricted plugin file public contract', () => {
  it('exports a host-only authority factory', async () => {
    const module = await import('./restricted-plugin-files').catch(() => ({}))
    expect(module).toHaveProperty('createRestrictedPluginFileAuthority', expect.any(Function))
  })
})
