import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SCENARIO_SPECS } from '../scenarioSpecs';
import type { ScenarioId } from '../data';
import { normalizeAgentResponse } from './agentClient';

describe('normalizeAgentResponse', () => {
  it('normalizes structured AgentServer JSON embedded in text', () => {
    const response = normalizeAgentResponse('literature-evidence-review', 'KRAS evidence?', {
      ok: true,
      data: {
        run: {
          id: 'run-structured-1',
          status: 'completed',
          output: {
            result: [
              '已完成。',
              '```json',
              JSON.stringify({
                message: 'KRAS G12C 耐药证据已归档。',
                confidence: 0.92,
                claimType: 'fact',
                evidenceLevel: 'cohort',
                claims: [{
                  id: 'claim-1',
                  text: 'EGFR/MET bypass is a supported resistance route.',
                  type: 'inference',
                  confidence: 0.89,
                  evidenceLevel: 'cohort',
                  supportingRefs: ['paper-1'],
                  opposingRefs: [],
                }],
                uiManifest: [{
                  componentId: 'paper-card-list',
                  title: 'Papers',
                  artifactRef: 'papers-1',
                  priority: 1,
                }],
                executionUnits: [{
                  id: 'EU-1',
                  tool: 'literature.search',
                  params: { query: 'KRAS G12C resistance' },
                  status: 'done',
                  hash: 'abc123',
                  artifacts: ['papers-1'],
                }],
                artifacts: [{
                  id: 'papers-1',
                  type: 'paper-list',
                  schemaVersion: '1',
                  data: { papers: [{ title: 'Paper A', year: 2024 }] },
                }],
              }),
              '```',
            ].join('\n'),
          },
        },
      },
    });

    assert.equal(response.message.content, 'KRAS G12C 耐药证据已归档。');
    assert.equal(response.message.confidence, 0.92);
    assert.equal(response.claims[0].id, 'claim-1');
    assert.equal(response.uiManifest[0].componentId, 'paper-card-list');
    assert.equal(response.uiManifest[0].artifactRef, 'papers-1');
    assert.equal(response.executionUnits[0].params, '{"query":"KRAS G12C resistance"}');
    assert.equal(response.executionUnits[0].status, 'done');
    assert.equal(response.artifacts[0].id, 'papers-1');
  });

  it('normalizes plain text responses without inventing artifacts', () => {
    const response = normalizeAgentResponse('structure-exploration', 'Analyze PDB 7BZ5', {
      run: {
        id: 'plain-run-1',
        status: 'completed',
        output: {
          text: '7BZ5 结构分析完成，但后端没有返回结构化协议。',
        },
      },
    });

    assert.equal(response.message.content, '7BZ5 结构分析完成，但后端没有返回结构化协议。');
    assert.equal(response.claims.length, 1);
    assert.equal(response.executionUnits.length, 1);
    assert.equal(response.executionUnits[0].tool, 'structure-exploration.scenario-server-run');
    assert.equal(response.executionUnits[0].status, 'done');
    assert.equal(response.uiManifest.length, 0);
  });

  it('surfaces research-report artifacts as readable markdown instead of raw JSON', () => {
    const response = normalizeAgentResponse('literature-evidence-review', '总结 arXiv AI Agent 论文', {
      ok: true,
      data: {
        run: {
          id: 'run-report-json-1',
          status: 'completed',
          output: {
            result: [
              '```json',
              JSON.stringify({
                message: JSON.stringify({
                  artifactType: 'research-report',
                  encoding: 'markdown',
                  data: {
                    title: 'AI Agent Literature Review',
                    sections: [
                      { title: 'Executive Summary', content: 'Recent AI Agent papers emphasize tool use and evaluation.' },
                      { title: 'Key Findings', content: '- Tool orchestration is central.\n- Benchmarks remain fragmented.' },
                    ],
                  },
                }),
                confidence: 0.86,
                claimType: 'analysis',
                evidenceLevel: 'preprint',
                artifacts: [{
                  id: 'research-report',
                  type: 'research-report',
                  schemaVersion: '1',
                  data: {
                    content: JSON.stringify({
                      data: {
                        sections: [
                          { title: 'Executive Summary', content: 'Recent AI Agent papers emphasize tool use and evaluation.' },
                          { title: 'Key Findings', content: '- Tool orchestration is central.\n- Benchmarks remain fragmented.' },
                        ],
                      },
                    }),
                  },
                }],
                uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
                executionUnits: [],
              }),
              '```',
            ].join('\n'),
          },
        },
      },
    });

    assert.match(response.message.content, /## Executive Summary/);
    assert.match(response.message.content, /Recent AI Agent papers emphasize tool use/);
    assert.doesNotMatch(response.message.content, /^\s*\{/);
    assert.equal(response.uiManifest[0].componentId, 'report-viewer');
    assert.equal(response.artifacts[0].type, 'research-report');
  });

  it('normalizes text-like artifact string data without changing array artifacts', () => {
    const response = normalizeAgentResponse('literature-evidence-review', 'artifact shapes', {
      ok: true,
      data: {
        run: {
          id: 'run-artifact-shapes',
          status: 'completed',
          output: {
            result: JSON.stringify({
              message: 'artifacts ready',
              confidence: 0.8,
              claimType: 'fact',
              evidenceLevel: 'runtime',
              artifacts: [{
                id: 'research-report',
                type: 'research-report',
                schemaVersion: '1',
                data: '# Report\n\nBody',
              }, {
                id: 'paper-list',
                type: 'paper-list',
                schemaVersion: '1',
                path: '.bioagent/task-results/papers.json',
                data: [{ title: 'Paper A' }, { title: 'Paper B' }],
              }],
            }),
          },
        },
      },
    });

    assert.deepEqual(response.artifacts[0].data, {
      markdown: '# Report\n\nBody',
      text: '# Report\n\nBody',
      report: '# Report\n\nBody',
    });
    assert.ok(Array.isArray(response.artifacts[1].data));
    assert.equal((response.artifacts[1].data as unknown[]).length, 2);
    assert.equal(response.artifacts[1].path, '.bioagent/task-results/papers.json');
  });

  it('preserves every skillDomain default artifact contract through normalization', () => {
    (Object.keys(SCENARIO_SPECS) as ScenarioId[]).forEach((scenarioId) => {
      const skillDomain = SCENARIO_SPECS[scenarioId];
      const artifact = skillDomain.outputArtifacts[0];
      const slot = skillDomain.defaultSlots.find((item) => item.artifactRef === artifact.type) ?? skillDomain.defaultSlots[0];
      const response = normalizeAgentResponse(scenarioId, `fixture ${scenarioId}`, {
        run: {
          id: `run-${scenarioId}`,
          status: 'completed',
          output: {
            text: [
              'fixture',
              '```json',
              JSON.stringify({
                message: `${scenarioId} fixture`,
                uiManifest: [slot],
                artifacts: [{
                  type: artifact.type,
                  schemaVersion: '1',
                  data: fixtureDataForArtifact(artifact.type),
                }],
                executionUnits: [{
                  id: `EU-${scenarioId}`,
                  tool: `${scenarioId}.fixture`,
                  params: { prompt: scenarioId },
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

      assert.equal(response.uiManifest[0].artifactRef, artifact.type);
      assert.equal(response.artifacts[0].id, artifact.type);
      assert.equal(response.artifacts[0].type, artifact.type);
      assert.equal(response.executionUnits[0].environment, skillDomain.executionDefaults.environment);
      assert.deepEqual(response.executionUnits[0].databaseVersions, skillDomain.executionDefaults.databaseVersions);
      assert.deepEqual(response.executionUnits[0].outputArtifacts, [artifact.type]);
    });
  });

  it('preserves repair and self-heal execution states', () => {
    const response = normalizeAgentResponse('omics-differential-exploration', 'bad omics run', {
      run: {
        id: 'run-repair-1',
        status: 'completed',
        output: {
          text: [
            'repair state',
            '```json',
            JSON.stringify({
              message: 'Repair needed.',
              executionUnits: [
                {
                  id: 'EU-repair',
                  tool: 'bioagent.workspace-runtime-gateway',
                  params: { reason: 'missing matrixRef' },
                  status: 'repair-needed',
                  hash: 'repair-hash',
                  codeRef: '.bioagent/tasks/omics.py',
                  stderrRef: '.bioagent/logs/omics.stderr.log',
                  failureReason: 'matrixRef and metadataRef are required',
                },
                {
                  id: 'EU-healed',
                  tool: 'bioagent.workspace-runtime-gateway',
                  params: {},
                  status: 'self-healed',
                  hash: 'healed-hash',
                  attempt: 2,
                  parentAttempt: 1,
                  selfHealReason: 'schema validation failed',
                  patchSummary: 'Added missing artifacts field.',
                  diffRef: '.bioagent/diffs/attempt-2.patch',
                },
                {
                  id: 'EU-failed-reason',
                  tool: 'bioagent.workspace-runtime-gateway',
                  params: {},
                  status: 'failed-with-reason',
                  hash: 'failed-reason-hash',
                  failureReason: 'AgentServer unavailable',
                },
              ],
              artifacts: [],
              uiManifest: [],
              claims: [],
            }),
            '```',
          ].join('\n'),
        },
      },
    });

    assert.equal(response.executionUnits[0].status, 'repair-needed');
    assert.equal(response.executionUnits[0].failureReason, 'matrixRef and metadataRef are required');
    assert.equal(response.executionUnits[1].status, 'self-healed');
    assert.equal(response.executionUnits[1].parentAttempt, 1);
    assert.equal(response.executionUnits[1].patchSummary, 'Added missing artifacts field.');
    assert.equal(response.executionUnits[2].status, 'failed-with-reason');
  });

  it('preserves view composition fields in UIManifest slots', () => {
    const response = normalizeAgentResponse('omics-differential-exploration', 'color UMAP by cell cycle', {
      run: {
        id: 'run-view-composition',
        status: 'completed',
        output: {
          text: [
            'view composition',
            '```json',
            JSON.stringify({
              message: 'UMAP view updated.',
              uiManifest: [{
                componentId: 'umap-viewer',
                artifactRef: 'omics-differential-expression',
                encoding: { colorBy: 'cellCycle', splitBy: 'batch', syncViewport: true },
                layout: { mode: 'side-by-side', columns: 2 },
                compare: { artifactRefs: ['batch-a', 'batch-b'], mode: 'side-by-side' },
              }],
              executionUnits: [],
              artifacts: [],
              claims: [],
            }),
            '```',
          ].join('\n'),
        },
      },
    });

    assert.equal(response.uiManifest[0].encoding?.colorBy, 'cellCycle');
    assert.equal(response.uiManifest[0].encoding?.splitBy, 'batch');
    assert.equal(response.uiManifest[0].layout?.mode, 'side-by-side');
    assert.equal(response.uiManifest[0].compare?.mode, 'side-by-side');
  });

  it('does not convert unknown execution status into record-only success and preserves export policy fields', () => {
    const response = normalizeAgentResponse('omics-differential-exploration', 'restricted export artifact', {
      run: {
        id: 'run-export-policy',
        status: 'completed',
        output: {
          text: [
            'export policy',
            '```json',
            JSON.stringify({
              message: 'Artifact has collaboration policy.',
              executionUnits: [{
                id: 'EU-unknown-status',
                tool: 'omics.runner',
                params: {},
                status: 'unexpected-successish-status',
                hash: 'hash-unknown-status',
              }],
              artifacts: [{
                id: 'artifact-restricted',
                type: 'omics-differential-expression',
                schemaVersion: '1',
                visibility: 'restricted-sensitive',
                audience: ['team-a'],
                sensitiveDataFlags: ['human-subject'],
                exportPolicy: 'restricted',
              }],
              uiManifest: [],
              claims: [],
            }),
            '```',
          ].join('\n'),
        },
      },
    });

    assert.equal(response.executionUnits[0].status, 'failed-with-reason');
    assert.equal(response.artifacts[0].visibility, 'restricted-sensitive');
    assert.deepEqual(response.artifacts[0].audience, ['team-a']);
    assert.deepEqual(response.artifacts[0].sensitiveDataFlags, ['human-subject']);
    assert.equal(response.artifacts[0].exportPolicy, 'restricted');
  });

  it('preserves notebook timeline belief and dependency refs', () => {
    const response = normalizeAgentResponse('literature-evidence-review', 'belief notebook refs', {
      run: {
        id: 'run-notebook-belief',
        status: 'completed',
        output: {
          text: [
            'notebook refs',
            '```json',
            JSON.stringify({
              message: 'Belief refs attached.',
              claims: [{
                id: 'claim-belief-1',
                text: 'Claim with dependencies.',
                dependencyRefs: ['paper-1', 'assumption-1'],
                updateReason: 'new opposing evidence reviewed',
              }],
              notebook: [{
                id: 'note-belief-1',
                title: 'Belief update',
                desc: 'Notebook entry with refs.',
                beliefRefs: ['belief-graph-1', 'decision-1'],
                dependencyRefs: ['paper-1'],
                artifactRefs: ['artifact-paper-list'],
                executionUnitRefs: ['EU-literature'],
                updateReason: 'manual review',
              }],
              executionUnits: [{
                id: 'EU-literature',
                tool: 'literature.search',
                params: {},
                status: 'done',
                hash: 'hash-literature',
              }],
              artifacts: [{
                id: 'artifact-paper-list',
                type: 'paper-list',
                schemaVersion: '1',
              }],
            }),
            '```',
          ].join('\n'),
        },
      },
    });

    assert.equal(response.notebook[0].id, 'note-belief-1');
    assert.deepEqual(response.notebook[0].beliefRefs, ['belief-graph-1', 'decision-1']);
    assert.deepEqual(response.notebook[0].dependencyRefs, ['paper-1']);
    assert.deepEqual(response.notebook[0].artifactRefs, ['artifact-paper-list']);
    assert.deepEqual(response.notebook[0].executionUnitRefs, ['EU-literature']);
    assert.equal(response.notebook[0].updateReason, 'manual review');
  });
});

function fixtureDataForArtifact(type: string) {
  if (type === 'paper-list') {
    return { papers: [{ title: 'Fixture paper', source: 'PubMed', year: '2026', evidenceLevel: 'cohort' }] };
  }
  if (type === 'structure-summary') {
    return { pdbId: '7BZ5', ligand: '6SI', highlightResidues: ['Y96D'], metrics: { pLDDT: 94.2, resolution: 1.79, pocketVolume: 628 } };
  }
  if (type === 'omics-differential-expression') {
    return {
      points: [{ gene: 'TP53', logFC: -1.8, pValue: 0.00001, significant: true }],
      heatmap: { matrix: [[1, -1], [0.5, -0.25]] },
      umap: [{ x: 0, y: 1, cluster: 'case' }],
    };
  }
  return {
    nodes: [{ id: 'KRAS', label: 'KRAS', type: 'gene' }, { id: 'SOTORASIB', label: 'Sotorasib', type: 'drug' }],
    edges: [{ source: 'KRAS', target: 'SOTORASIB', relation: 'targeted_by' }],
    rows: [{ key: 'approved_drugs', value: 'sotorasib' }],
  };
}
