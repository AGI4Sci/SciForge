import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('hotplug integration retains one identity-bound inventory transport', () => {
  const paths = [
    'src/main/extensions/development-external-plugins.ts',
    'src/preload/index.ts',
    'src/shared/domain-extensions.ts',
    'src/renderer/src/components/extensions/DevelopmentPluginPanelHost.tsx'
  ]
  for (const path of paths) assert.doesNotMatch(source(path), /^(<<<<<<<|=======|>>>>>>>)/m, path)
  const preload = source(paths[1])
  assert.match(preload, /list: async \(input\) => unwrapCapabilityTransportEnvelope/)
  assert.match(preload, /ipcRenderer\.invoke\('extensions:list', input\)/)
  const panel = source(paths[3])
  assert.match(panel, /event\.source !== iframe\.contentWindow/)
  assert.match(panel, /extensions\.list\(\{ pluginId, contributionId, generation, version \}\)/)
  assert.match(panel, /if \(disposed\) return/)
  assert.match(panel, /disposed = true/)
  assert.match(panel, /key=\{frameKey\}/)
  assert.match(panel, /sandbox="allow-scripts"/)
  const service = source(paths[0])
  for (const contract of ['inventoryAdmission(', 'prepareAgentCandidate(', 'checkAgentCandidate(', 'submitAgentCandidate(', 'requestAgentUpdate(', 'rendererAssetPath(']) assert.ok(service.includes(contract), contract)
  const ipc = source('src/main/ipc/register-app-ipc-handlers.ts')
  assert.equal([...ipc.matchAll(/handleInvoke\('extensions:renderer-contributions'/g)].length, 1, 'one strict renderer-contributions handler')
  assert.match(ipc, /parseIpcPayload\('extensions:renderer-contributions', domainExtensionRendererContributionsPayloadSchema/)
  assert.match(service, /schemaVersion: 4/)
  assert.doesNotMatch(service, /options\.restrictToManagedRoots === true &&/, 'managed-root admission is mandatory, including host candidate calls')
})
