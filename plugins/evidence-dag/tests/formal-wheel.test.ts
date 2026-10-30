import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { workerOptions } from './worker-fixture.js'

it('builds the formal pyproject wheel with its declared backend rather than synthesizing distribution metadata', async () => {
  const options = await workerOptions()
  const metadata = execFileSync(options.executable, ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("sciforge_evidence_dag-1.0.0.dist-info/METADATA").decode()); print(z.read("sciforge_evidence_dag-1.0.0.dist-info/WHEEL").decode())', options.wheelPath], { encoding: 'utf8' })
  expect(metadata).toContain('Summary: SciForge Evidence DAG compiler with Artifact Registry and immutable snapshots')
  expect(metadata).toContain('Generator: setuptools')
})
