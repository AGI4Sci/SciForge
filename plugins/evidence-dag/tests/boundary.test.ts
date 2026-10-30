import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
it('artifact provenance core has no full Host Context import or forwarding factories', async () => {
  const source = await readFile(new URL('../../../packages/domains/evidence-dag/src/main/artifact-version-client.ts', import.meta.url), 'utf8')
  expect(source).not.toContain('DomainMainRuntimeLifecycleContext')
  expect(source).not.toContain('context.capabilities.invoke')
})
