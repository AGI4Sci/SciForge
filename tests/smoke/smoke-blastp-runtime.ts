import assert from 'node:assert/strict';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const result = await runWorkspaceRuntimeGateway({
  skillDomain: 'knowledge',
  workspacePath: process.cwd(),
  prompt: 'BLASTP protein sequence alignment: sequence=MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKT database=swissprot hitlist=5。展示 BLAST 比对结果表、alignment details inspector 和 execution unit，不需要 network graph。',
});

const components = result.uiManifest.map((slot) => String(slot.componentId));
const artifact = result.artifacts.find((item) => item.type === 'sequence-alignment');
const data = artifact?.data as { rows?: unknown[] } | undefined;

assert.ok(artifact, 'sequence-alignment artifact missing');
assert.ok(Array.isArray(data?.rows) && data.rows.length > 0, 'BLAST rows missing');
assert.ok(components.includes('record-table'), 'record-table missing');
assert.ok(components.includes('unknown-artifact-inspector'), 'unknown-artifact-inspector missing');
assert.ok(components.includes('execution-unit-table'), 'execution-unit-table missing');
assert.ok(!components.includes('graph-viewer'), 'graph-viewer should be excluded by prompt');
assert.equal(result.executionUnits[0]?.tool, 'NCBI.BLAST.URLAPI.blastp');
assert.equal(result.executionUnits[0]?.status, 'done');

console.log(`[ok] BLASTP runtime returned ${data.rows.length} hits and dynamic UIManifest: ${components.join(', ')}`);
