import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { tryRunLocalMethodologyFinalizerRuntime } from './local-methodology-finalizer-runtime.js';
import { isRecord } from './gateway-utils.js';

test('local methodology finalizer writes a durable protocol package from current artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-methodology-finalizer-'));
  const payload = await tryRunLocalMethodologyFinalizerRuntime({
    skillDomain: 'literature',
    workspacePath: workspace,
    prompt: '请基于当前可见的上一轮 methodology artifact 写入最终 protocol package，生成最终方案文件、sample/statistics table、risk register、execution checklist、preregistration notes；不要调用 AgentServer，不要访问外部资源。把技术重复降为非独立单位，按 9 条独立细胞系解释功效。',
    artifacts: [{
      id: 'methodology-report',
      type: 'research-report',
      data: {
        markdown: [
          'iPSC neuron mitochondria methodology artifact.',
          'Design: randomized blinded Seahorse OCR assay with vehicle and positive control, batch-balanced plates, and a fixed primary endpoint.',
          'Alternative: if budget or QC fails, stage a pilot MDE estimate and defer secondary omics.',
          'There are 9 independent cell lines with 2 technical replicates per line.',
          'Next step: treat technical replicates as non-independent and use exploratory minimum detectable effect language.',
          'Protocol, sample/statistics table, risk register, execution checklist, and preregistration notes are required.',
        ].join('\n'),
      },
    }],
  });

  assert.ok(payload);
  assert.equal(payload.displayIntent?.taskOutcome, 'satisfied');
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-methodology-finalizer.write-package');
  assert.match(payload.message, /写入 task-results\/methodology-final-package-/);
  assert.match(payload.message, /9 independent biological units|9 个独立/);
  assert.doesNotMatch(payload.message, /AgentServer generation stopped|repair-needed/i);

  const protocolRef = String(payload.artifacts.find((artifact) => artifact.id?.toString().endsWith('-protocol'))?.dataRef ?? '');
  assert.match(protocolRef, /task-results\/methodology-final-package-.+\/final_protocol\.md/);
  const protocol = await readFile(join(workspace, protocolRef), 'utf8');
  assert.match(protocol, /Final Methodology Protocol Package/);
  assert.match(protocol, /技术重复|technical replicates/i);
  assert.match(protocol, /minimum detectable effect/i);
  assert.match(protocol, /Hard Requirements Matrix/);
  assert.match(protocol, /Alternative|替代方案/i);
  assert.match(protocol, /randomized blinded Seahorse OCR assay|随机/i);
  assert.doesNotMatch(protocol, /80%\s+power.{0,80}d\s*=\s*0\.8|d\s*=\s*0\.8.{0,80}80%\s+power/i);

  for (const name of ['sample_statistics.md', 'risk_register.md', 'execution_checklist.md', 'alternative_plan.md', 'preregistration_notes.md', 'manifest.json']) {
    const ref = protocolRef.replace('final_protocol.md', name);
    assert.ok(await readFile(join(workspace, ref), 'utf8'));
  }

  const protocolObject = payload.objectReferences?.find((reference) => reference.id === payload.objectReferences?.[0]?.id);
  assert.equal(protocolObject?.ref, `artifact:${payload.artifacts.find((artifact) => artifact.id?.toString().endsWith('-protocol'))?.id}`);
  const provenance = isRecord(protocolObject?.provenance) ? protocolObject.provenance : {};
  assert.match(String(provenance.dataRef), /final_protocol\.md/);
  assert.equal(protocolObject?.presentationRole, 'primary-deliverable');
});

test('local methodology finalizer can recover context from latest session bundle when projection session id is stale', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-methodology-finalizer-session-'));
  const artifactDir = join(workspace, '.sciforge', 'sessions', '2026-05-18_methodology-design-review_session', 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'sample-statistics.json'), JSON.stringify({
    id: 'sample-statistics',
    type: 'text/markdown',
    data: {
      markdown: [
        'Prior methodology artifact: 9 independent organoid lines.',
        'Technical replicates are non-independent and must be nested within line.',
        'Risk register and final protocol package are required.',
      ].join('\n'),
    },
  }, null, 2));

  const payload = await tryRunLocalMethodologyFinalizerRuntime({
    skillDomain: 'literature',
    workspacePath: workspace,
    prompt: '基于刚才已有 artifact 写回最终 protocol artifact/package，保存文件路径，更新 sample/statistics table、risk register、execution checklist；不要调用 AgentServer。',
    artifacts: [],
    uiState: { sessionId: 'stale-session-id' },
  });

  assert.ok(payload);
  assert.equal(payload.displayIntent?.taskOutcome, 'satisfied');
  assert.match(payload.message, /task-results\/methodology-final-package-/);
  assert.match(JSON.stringify(payload.objectReferences), /final_protocol\.md/);
});

test('local methodology finalizer yields when request is read-only closure', async () => {
  const payload = await tryRunLocalMethodologyFinalizerRuntime({
    skillDomain: 'literature',
    workspacePath: await mkdtemp(join(tmpdir(), 'sciforge-methodology-finalizer-readonly-')),
    prompt: '不要写文件；只基于当前 artifact 说明 protocol、sample/statistics、risk register 是否可信。',
    artifacts: [{
      id: 'methodology-report',
      type: 'research-report',
      data: { markdown: 'Protocol artifact with 9 independent cell lines and technical replicates.' },
    }],
  });

  assert.equal(payload, undefined);
});
