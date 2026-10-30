import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { beforeAll, expect, it } from 'vitest'

const python = process.env.EVIDENCE_BUILD_PYTHON!
let wheel: string
const root = mkdtempSync(join(tmpdir(), 'canonical-read-access-'))
const fixture = String.raw`
import json, pathlib, subprocess, sys
sys.path.insert(0, sys.argv[1])
import evidence_dag
from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import Artifact, ArtifactVersion, SourceAnchor, SourceSelector, Node, NodeType
from evidence_dag.service import Engine
from evidence_dag.snapshot import build_snapshot
wheel, root, policy, operation = sys.argv[1:]
assert evidence_dag.__file__.replace('\\', '/').startswith(wheel.replace('\\', '/') + '/'), evidence_dag.__file__
workspace = str(pathlib.Path(root) / 'workspace')
pathlib.Path(workspace).mkdir()
storage = str(pathlib.Path(root) / 'storage')
graph = ThreadGraph('thread:canonical-read', meta={'scope': {'workspaceRoot': workspace, 'accessPolicy': {'visibility': 'public'}}})
artifact = Artifact('artifact:secret', 'file', '2026-01-01', 'version:secret', {'visibility': 'private'} if policy == 'artifact' else {})
graph.artifacts[artifact.artifact_id] = artifact
availability = {'availability': 'restricted', 'future-availability': 'future', 'malformed-availability': None}.get(policy, 'available')
graph.artifact_versions['version:secret'] = ArtifactVersion('version:secret', artifact.artifact_id, '/secret/location', 'sha256:' + 'a'*64, None, 7, 'text/plain', '2026-01-01', availability, 'keep')
graph.source_anchors['anchor:secret'] = SourceAnchor('anchor:secret', artifact.artifact_id, 'version:secret', SourceSelector('text', quote='SECRET-CANONICAL-CONTENT'), 'sha256:' + 'b'*64, '2026-01-01', {'visibility': 'private'} if policy == 'anchor' else {})
graph.nodes['node:secret'] = Node('node:secret', NodeType.CLAIM, 'SECRET-CANONICAL-CONTENT', artifact_id=artifact.artifact_id)
graph.nodes['node:public'] = Node('node:public', NodeType.CLAIM, 'Disconnected public component')
if policy == 'scope':
    graph.meta['scope']['accessPolicy'] = {'visibility': 'private'}
snapshot = build_snapshot(graph, version=1, input_watermark='1')
graph.meta['snapshot'] = snapshot.to_dict()
engine = Engine(storage_dir=storage)
engine._commit_snapshot(graph, snapshot)
request = {'type': 'request', 'id': 'canonical-read', 'operation': operation, 'input': {'threadId': graph.thread_id, 'snapshotDigest': snapshot.digest, 'workspaceRoot': workspace, 'datacite': {}}}
child = subprocess.run([sys.executable, '-I', '-S', '-u', '-c', 'import sys;sys.path.insert(0,sys.argv[1]);from evidence_dag.runtime_stdio import main;main()', wheel, storage], input=json.dumps(request)+'\n', text=True, capture_output=True, timeout=20)
assert child.returncode == 0, child.stderr
responses = [json.loads(line) for line in child.stdout.splitlines()]
assert len(responses) == 1, responses
response = responses[0]
assert response['id'] == request['id'], response
if policy == 'public' and operation == 'readSnapshot':
    assert response['ok'] is True, response
    assert response['value']['graph'] == graph.to_dict()
    assert response['value']['document'] == provjson.dumps(graph)
    assert response['value']['snapshot']['digest'] == snapshot.digest
print(json.dumps(response))
`
beforeAll(() => {
  expect(isAbsolute(python)).toBe(true)
  const output = join(root, 'wheel')
  execFileSync(python, [resolve('plugins/evidence-dag/scripts/build-wheel.py'), resolve('packages/domains/evidence-dag/python'), output], { env: process.env, stdio: 'pipe' })
  wheel = join(output, 'sciforge_evidence_dag-1.0.0-py3-none-any.whl')
  expect(readFileSync(wheel).length).toBeGreaterThan(0)
}, 60_000)

function read(policy: string, operation: string) {
  const directory = join(root, `${policy}-${operation}`)
  mkdirSync(directory)
  return JSON.parse(execFileSync(python, ['-I', '-S', '-c', fixture, wheel, directory, policy, operation], { encoding: 'utf8', env: process.env }))
}

for (const operation of ['readSnapshot', 'snapshotProducts']) {
  for (const policy of ['artifact', 'anchor', 'availability', 'future-availability', 'malformed-availability', 'scope']) {
    it(`rejects the entire canonical ${operation} for ${policy} restrictions in a real wheel child`, () => {
      const result = read(policy, operation)
      expect(result.ok).toBe(false)
      expect(result.error.code).toBe('PermissionError')
      expect(result).not.toHaveProperty('value')
      expect(JSON.stringify(result)).not.toMatch(/SECRET-CANONICAL-CONTENT|secret\/location|artifact:secret|anchor:secret/)
    })
  }
}
it('retains the exact full public graph, PROV document and original digest after cold wheel readback', () => {
  expect(read('public', 'readSnapshot').ok).toBe(true)
})
