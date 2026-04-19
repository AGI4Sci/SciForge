import assert from 'node:assert/strict';

import { BIOAGENT_PROFILES } from '../ui/src/agentProfiles';
import type { AgentId } from '../ui/src/data';
import { normalizeAgentResponse } from '../ui/src/api/agentClient';

const agentIds = Object.keys(BIOAGENT_PROFILES) as AgentId[];

for (const agentId of agentIds) {
  const profile = BIOAGENT_PROFILES[agentId];
  const artifact = profile.outputArtifacts[0];
  const slot = profile.defaultSlots.find((item) => item.artifactRef === artifact.type) ?? profile.defaultSlots[0];
  const normalized = normalizeAgentResponse(agentId, `smoke ${agentId}`, {
    run: {
      id: `smoke-run-${agentId}`,
      status: 'completed',
      output: {
        text: [
          `${agentId} smoke completed.`,
          '```json',
          JSON.stringify({
            message: `${agentId} fixture normalized`,
            confidence: 0.91,
            claimType: 'fact',
            evidenceLevel: evidenceForAgent(agentId),
            reasoningTrace: `fixture path for ${agentId}`,
            claims: [{
              id: `claim-${agentId}`,
              text: `${agentId} artifact follows BioAgent contract`,
              type: 'fact',
              confidence: 0.91,
              evidenceLevel: evidenceForAgent(agentId),
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
              id: `EU-${agentId}`,
              tool: `${agentId}.fixture`,
              params: { input: `smoke ${agentId}` },
              status: profile.executionDefaults.status,
              hash: `hash-${agentId}`,
              environment: profile.executionDefaults.environment,
              databaseVersions: profile.executionDefaults.databaseVersions,
              outputArtifacts: [artifact.type],
            }],
          }),
          '```',
        ].join('\n'),
      },
    },
  });

  assert.equal(normalized.message.content, `${agentId} fixture normalized`);
  assert.equal(normalized.uiManifest[0].artifactRef, artifact.type);
  assert.equal(normalized.artifacts[0].id, artifact.type);
  assert.equal(normalized.artifacts[0].type, artifact.type);
  assert.equal(normalized.executionUnits[0].environment, profile.executionDefaults.environment);
  assert.deepEqual(normalized.executionUnits[0].databaseVersions, profile.executionDefaults.databaseVersions);
  assert.equal(normalized.claims[0].supportingRefs[0], `${artifact.type}:fixture`);
  console.log(`[ok] ${agentId} -> ${artifact.type}`);
}

function evidenceForAgent(agentId: AgentId) {
  if (agentId === 'literature') return 'review';
  if (agentId === 'structure') return 'database';
  if (agentId === 'omics') return 'experimental';
  return 'database';
}

function dataForArtifact(type: string) {
  if (type === 'paper-list') {
    return {
      query: 'KRAS G12C resistance',
      papers: [{
        title: 'Fixture KRAS paper',
        authors: ['BioAgent'],
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
