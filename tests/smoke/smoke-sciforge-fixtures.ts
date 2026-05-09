import assert from 'node:assert/strict';

import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import type { ScenarioId } from '../../src/ui/src/data';
import { normalizeAgentResponse } from '../../src/ui/src/api/agentClient';

const scenarioIds = Object.keys(SCENARIO_SPECS) as ScenarioId[];

for (const scenarioId of scenarioIds) {
  const skillDomain = SCENARIO_SPECS[scenarioId];
  const artifact = skillDomain.outputArtifacts[0];
  const slot = skillDomain.defaultSlots.find((item) => item.artifactRef === artifact.type) ?? skillDomain.defaultSlots[0];
  const normalized = normalizeAgentResponse(scenarioId, `smoke ${scenarioId}`, {
    run: {
      id: `smoke-run-${scenarioId}`,
      status: 'completed',
      output: {
        text: [
          `${scenarioId} smoke completed.`,
          '```json',
          JSON.stringify({
            message: `${scenarioId} fixture normalized`,
            confidence: 0.91,
            claimType: 'fact',
            evidenceLevel: evidenceForAgent(scenarioId),
            reasoningTrace: `fixture path for ${scenarioId}`,
            claims: [{
              id: `claim-${scenarioId}`,
              text: `${scenarioId} artifact follows SciForge contract`,
              type: 'fact',
              confidence: 0.91,
              evidenceLevel: evidenceForAgent(scenarioId),
              supportingRefs: [`${artifact.type}:fixture`],
              opposingRefs: [],
            }],
            uiManifest: [slot],
            artifacts: [{
              type: artifact.type,
              schemaVersion: '1',
              metadata: { fixture: true },
              data: dataForArtifact(artifact.type),
            }],
            executionUnits: [{
              id: `EU-${scenarioId}`,
              tool: `${scenarioId}.fixture`,
              params: { input: `smoke ${scenarioId}` },
              status: skillDomain.executionDefaults.status,
              hash: `hash-${scenarioId}`,
              environment: skillDomain.executionDefaults.environment,
              databaseVersions: skillDomain.executionDefaults.databaseVersions,
              outputArtifacts: [artifact.type],
            }],
          }),
          '```',
        ].join('\n'),
      },
    },
  });

  assert.equal(normalized.message.content, `${scenarioId} fixture normalized`);
  assert.equal(normalized.uiManifest[0].artifactRef, artifact.type);
  assert.equal(normalized.artifacts[0].id, artifact.type);
  assert.equal(normalized.artifacts[0].type, artifact.type);
  assert.equal(normalized.executionUnits[0].environment, skillDomain.executionDefaults.environment);
  assert.deepEqual(normalized.executionUnits[0].databaseVersions, skillDomain.executionDefaults.databaseVersions);
  assert.equal(normalized.claims[0].supportingRefs[0], `${artifact.type}:fixture`);
  console.log(`[ok] ${scenarioId} -> ${artifact.type}`);
}

function evidenceForAgent(scenarioId: ScenarioId) {
  if (scenarioId === 'literature-evidence-review') return 'review';
  if (scenarioId === 'structure-exploration') return 'database';
  if (scenarioId === 'omics-differential-exploration') return 'experimental';
  return 'database';
}

function dataForArtifact(type: string) {
  if (type === 'paper-list') {
    return {
      query: 'KRAS G12C resistance',
      papers: [{
        title: 'Fixture KRAS paper',
        authors: ['SciForge'],
        journal: 'Fixture Journal',
        year: '2026',
        url: 'https://example.org/paper',
        abstract: 'Fixture abstract.',
        evidenceLevel: 'review',
      }],
    };
  }
  if (type === 'structure-summary') {
    return {
      pdbId: '7BZ5',
      ligand: '6SI',
      highlightResidues: ['Y96D', 'H95'],
      metrics: { pLDDT: 94.2, resolution: 1.79, pocketVolume: 628, mutationRisk: 'Y96D' },
    };
  }
  if (type === 'omics-differential-expression') {
    return {
      points: [
        { gene: 'TP53', logFC: -1.82, pValue: 0.00001, fdr: 0.001, significant: true },
        { gene: 'MYC', logFC: 2.3, pValue: 0.0004, fdr: 0.01, significant: true },
      ],
      heatmap: { matrix: [[1, -1, 0.5], [0.2, -0.4, 1.2]], label: 'fixture expression matrix' },
      umap: [{ x: 0, y: 1, cluster: 'treated' }, { x: 1, y: 0, cluster: 'control' }],
    };
  }
  return {
    nodes: [
      { id: 'KRAS', label: 'KRAS', type: 'gene', confidence: 0.96 },
      { id: 'SOTORASIB', label: 'Sotorasib', type: 'drug', confidence: 0.94 },
    ],
    edges: [{ source: 'KRAS', target: 'SOTORASIB', relation: 'targeted_by', evidenceLevel: 'database' }],
    rows: [{ key: 'approved_drugs', value: 'sotorasib', source: 'ChEMBL fixture' }],
  };
}
