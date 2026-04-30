import assert from 'node:assert/strict';
import { normalizeAgentResponse } from '../../src/ui/src/api/agentClient';

const response = normalizeAgentResponse('literature-evidence-review', 'show the latest PDB structure', {
  message: '已生成结构和报告。',
  confidence: 0.91,
  claimType: 'fact',
  evidenceLevel: 'database',
  displayIntent: {
    primaryGoal: 'inspect protein structure',
    requiredArtifactTypes: ['structure-summary'],
    preferredModules: ['protein-structure-viewer'],
  },
  claims: [{
    id: 'claim-1',
    text: 'PDB 7RPZ is available.',
    type: 'fact',
    confidence: 0.91,
    evidenceLevel: 'database',
    supportingRefs: ['artifact:structure-summary'],
    opposingRefs: [],
  }],
  uiManifest: [{
    componentId: 'molecule-viewer',
    artifactRef: 'structure-summary',
    priority: 1,
  }],
  executionUnits: [{
    id: 'pdb-search',
    tool: 'pdb.search',
    params: '{}',
    status: 'done',
    hash: 'abc123',
  }],
  artifacts: [{
    id: 'structure-summary',
    type: 'structure-summary',
    schemaVersion: '1',
    dataRef: 'https://files.rcsb.org/download/7RPZ.pdb',
    metadata: { title: 'PDB 7RPZ', executionUnitId: 'pdb-search' },
    data: { pdbId: '7RPZ', method: 'X-ray' },
  }, {
    id: 'research-report',
    type: 'research-report',
    schemaVersion: '1',
    path: '/tmp/report.md',
    data: { markdown: '# Report' },
  }],
  objectReferences: [{
    id: 'obj-7rpz',
    title: 'PDB 7RPZ',
    kind: 'artifact',
    ref: 'artifact:structure-summary',
    artifactType: 'structure-summary',
    preferredView: 'molecule-viewer',
    actions: ['focus-right-pane', 'inspect'],
  }],
});

assert.equal(response.message.objectReferences?.length, 2);
assert.equal(response.message.objectReferences?.[0].title, 'PDB 7RPZ');
assert.equal(response.message.objectReferences?.[0].preferredView, 'molecule-viewer');
assert.ok(response.message.objectReferences?.some((reference) => reference.ref === 'artifact:research-report'));
assert.deepEqual((response.run.raw as { displayIntent?: unknown }).displayIntent, {
  primaryGoal: 'inspect protein structure',
  requiredArtifactTypes: ['structure-summary'],
  preferredModules: ['protein-structure-viewer'],
});

console.log('[ok] objectReferences normalize from AgentServer payload and auto-index artifacts');
