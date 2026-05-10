import assert from 'node:assert/strict';

import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract';
import {
  findBestInteractiveViewModuleForArtifactType,
  interactiveViewManifests,
  validateInteractiveViewModuleBinding,
} from '../../packages/presentation/interactive-views/index.js';

type ScientificViewCase = {
  artifact: RuntimeArtifact;
  componentId: string;
};

const cases: ScientificViewCase[] = [
  {
    componentId: 'graph-viewer',
    artifact: {
      id: 'paper-claim-graph',
      type: 'paper-claim-graph',
      producerScenario: 'scientific-reproduction',
      schemaVersion: '1',
      data: {
        nodes: [{ id: 'claim-1', label: 'Main claim', type: 'claim' }],
        edges: [{ source: 'claim-1', target: 'figure-1', relation: 'supported-by' }],
      },
    },
  },
  {
    componentId: 'record-table',
    artifact: {
      id: 'dataset-inventory',
      type: 'dataset-inventory',
      producerScenario: 'scientific-reproduction',
      schemaVersion: '1',
      data: {
        rows: [{ accession: 'GSE000000', assay: 'ChIP-seq', availability: 'available' }],
      },
    },
  },
  {
    componentId: 'report-viewer',
    artifact: {
      id: 'analysis-plan',
      type: 'analysis-plan',
      producerScenario: 'scientific-reproduction',
      schemaVersion: '1',
      data: { sections: [{ title: 'Plan', content: 'Acquire data, reproduce figure, verify claim.' }] },
    },
  },
  {
    componentId: 'report-viewer',
    artifact: {
      id: 'figure-reproduction-report',
      type: 'figure-reproduction-report',
      producerScenario: 'scientific-reproduction',
      schemaVersion: '1',
      data: { summary: 'Figure reproduction completed with explicit input and parameter refs.' },
    },
  },
  {
    componentId: 'report-viewer',
    artifact: {
      id: 'claim-verdict',
      type: 'claim-verdict',
      producerScenario: 'scientific-reproduction',
      schemaVersion: '1',
      data: { summary: 'Claim is partially reproduced; missing evidence is listed.' },
    },
  },
  {
    componentId: 'report-viewer',
    artifact: {
      id: 'negative-result-report',
      type: 'negative-result-report',
      producerScenario: 'scientific-reproduction',
      schemaVersion: '1',
      data: { markdown: '## Negative result\nThe public data contradicts the reported trend.' },
    },
  },
  {
    componentId: 'report-viewer',
    artifact: {
      id: 'trajectory-training-record',
      type: 'trajectory-training-record',
      producerScenario: 'scientific-reproduction',
      schemaVersion: '1',
      data: { content: 'State/action/observation trace with refs-first artifact locators.' },
    },
  },
];

for (const { artifact, componentId } of cases) {
  const module = findBestInteractiveViewModuleForArtifactType(interactiveViewManifests, artifact.type);
  assert.equal(
    module?.componentId,
    componentId,
    `${artifact.type} should resolve through package manifests to ${componentId}`,
  );
  assert.equal(
    validateInteractiveViewModuleBinding(module, artifact).status,
    'bound',
    `${artifact.type} should bind without prompt or scenario routing`,
  );
}

const evidenceMatrix = interactiveViewManifests.find((module) => module.componentId === 'evidence-matrix');
assert.ok(evidenceMatrix);
for (const artifactType of ['evidence-matrix', 'claim-verdict', 'negative-result-report', 'figure-reproduction-report']) {
  assert.ok(
    evidenceMatrix.acceptsArtifactTypes.includes(artifactType),
    `evidence-matrix should explicitly accept ${artifactType}`,
  );
}

console.log('[ok] scientific reproduction artifacts resolve via package-owned view manifests without prompt routing');
