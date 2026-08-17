import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DOMAIN_RUNTIME_MCP_SELECTOR_FLAG,
  buildDomainRuntimeMcpProcessArgs,
  resolveDomainRuntimeMcpNodeEntryPath,
  selectedDomainRuntimeMcpContributionId
} from './runtime-mcp-launcher.js'

test('resolves the shared launcher from a source application root', () => {
  assert.equal(resolveDomainRuntimeMcpNodeEntryPath({
    appPath: '/workspace/SciForge',
    isPackaged: false
  }), '/workspace/SciForge/out/main/domain-runtime-mcp-node-entry.js')
})

test('resolves the shared launcher from packaged POSIX and Windows roots', () => {
  assert.equal(resolveDomainRuntimeMcpNodeEntryPath({
    appPath: '/Applications/SciForge.app/Contents/Resources/app.asar',
    isPackaged: true
  }), '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/domain-runtime-mcp-node-entry.js')
  assert.equal(resolveDomainRuntimeMcpNodeEntryPath({
    appPath: String.raw`C:\Program Files\SciForge\resources\app.asar`,
    isPackaged: true
  }), String.raw`C:\Program Files\SciForge\resources\app.asar.unpacked\out\main\domain-runtime-mcp-node-entry.js`)
})

test('builds and parses a contribution-scoped launcher argv', () => {
  const args = buildDomainRuntimeMcpProcessArgs(
    { appPath: '/workspace/SciForge', isPackaged: false },
    'fixture.runtime-mcp-server',
    ['--fixture-server']
  )
  assert.deepEqual(args, [
    '/workspace/SciForge/out/main/domain-runtime-mcp-node-entry.js',
    DOMAIN_RUNTIME_MCP_SELECTOR_FLAG,
    'fixture.runtime-mcp-server',
    '--fixture-server'
  ])
  assert.equal(
    selectedDomainRuntimeMcpContributionId(['node', ...args]),
    'fixture.runtime-mcp-server'
  )
  assert.equal(selectedDomainRuntimeMcpContributionId(['node', 'entry.js']), null)
  assert.throws(
    () => selectedDomainRuntimeMcpContributionId(['node', DOMAIN_RUNTIME_MCP_SELECTOR_FLAG]),
    /missing its contribution ID/
  )
})
