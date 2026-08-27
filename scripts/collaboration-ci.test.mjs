import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowSource = await readFile(
  new URL('../.github/workflows/collaboration-ci.yml', import.meta.url),
  'utf8'
)
const packageJson = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8'
))

function workflowEventSource(eventName) {
  const startMarker = `  ${eventName}:\n`
  const start = workflowSource.indexOf(startMarker)
  assert.notEqual(start, -1, `${eventName} trigger must exist`)
  const endMarker = eventName === 'pull_request' ? '  push:\n' : '\npermissions:\n'
  const end = workflowSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `${eventName} trigger must be bounded`)
  return workflowSource.slice(start, end)
}

test('routes every domain package and the Host Content Space integration into CI', () => {
  for (const eventName of ['pull_request', 'push']) {
    const source = workflowEventSource(eventName)
    assert.match(source, /^\s+- "packages\/domains\/\*\*"$/m)
    assert.match(
      source,
      /^\s+- "src\/main\/capabilities\/content-space-discovery\.test\.ts"$/m
    )
  }
})

test('runs every installed domain package test and typecheck through composition', () => {
  assert.match(workflowSource, /^\s+run: npm run domain-packages:test$/m)
  assert.match(workflowSource, /^\s+run: npm run typecheck$/m)
  assert.match(
    packageJson.scripts['domain-packages:test'],
    /domain-packages\.mjs --run test/
  )
  assert.match(
    packageJson.scripts.typecheck,
    /npm run domain-packages:typecheck/
  )
  assert.equal(
    packageJson.scripts['domain-packages:typecheck'],
    'node ./scripts/domain-packages.mjs --run typecheck'
  )
})

test('runs the Host Content Space Broker integration and this routing contract', () => {
  assert.match(
    workflowSource,
    /^\s+src\/main\/capabilities\/content-space-discovery\.test\.ts \\$/m
  )
  assert.match(
    workflowSource,
    /^\s+run: node --test scripts\/collaboration-ci\.test\.mjs$/m
  )
})

test('does not retain the parallel collaboration identity Token package', async () => {
  assert.equal(
    packageJson.workspaces.includes('packages/collaboration-identity'),
    false
  )
  assert.equal(
    Object.hasOwn(packageJson.dependencies, '@sciforge/collaboration-identity'),
    false
  )
  assert.doesNotMatch(
    packageJson.scripts['build:collaboration-dependencies'],
    /collaboration-identity/u
  )
  assert.doesNotMatch(workflowSource, /collaboration-identity/u)
  await assert.rejects(
    access(new URL('../packages/collaboration-identity', import.meta.url)),
    { code: 'ENOENT' }
  )
})
