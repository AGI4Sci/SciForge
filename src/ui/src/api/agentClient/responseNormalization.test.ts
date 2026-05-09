import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAgentResponse } from './responseNormalization';

test('normalizes verification metadata without leaking Verification footer into chat text', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '继续上一轮', {
    ok: true,
    data: {
      run: { id: 'run-verification-footer', status: 'completed' },
      output: {
        message: JSON.stringify({
          message: '这是给用户的实际回答。\n\nVerification: unverified. 默认使用轻量验证。',
          confidence: 0.72,
          claimType: 'fact',
          evidenceLevel: 'prediction',
          verificationResults: [{
            verdict: 'unverified',
            confidence: 0,
            critique: '默认使用轻量验证。',
            evidenceRefs: ['execution-unit:EU-1'],
            repairHints: [],
          }],
          displayIntent: {
            verification: { verdict: 'unverified', visible: true },
          },
          claims: [],
          uiManifest: [],
          executionUnits: [{ id: 'EU-1', tool: 'analysis.task', status: 'done', params: '{}' }],
          artifacts: [],
        }),
      },
    },
  });

  assert.equal(response.message.content, '这是给用户的实际回答。');
  assert.doesNotMatch(response.run.response, /Verification:/);
  const raw = response.run.raw as Record<string, unknown>;
  assert.equal((raw.verificationResults as Array<Record<string, unknown>>)[0]?.verdict, 'unverified');
});

test('normalizes ContractValidationFailure as failed diagnostic output with recover actions and related refs', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '生成报告', {
    ok: true,
    data: {
      run: { id: 'run-contract-failure', status: 'completed' },
      output: {
        message: JSON.stringify({
          contractValidationFailure: {
            contract: 'sciforge.contract-validation-failure.v1',
            schemaPath: '/artifacts/0/data',
            contractId: 'research-report.v1',
            capabilityId: 'report-viewer',
            failureKind: 'artifact-schema',
            missingFields: ['data.markdown'],
            invalidRefs: ['artifact:research-report'],
            unresolvedUris: ['file::.sciforge/missing/report.md'],
            failureReason: 'research-report artifact is missing markdown content.',
            recoverActions: ['regenerate report artifact with markdownRef'],
            nextStep: 'Repair the artifact payload before showing the report.',
            relatedRefs: ['execution-unit:EU-report', 'artifact:research-report'],
            issues: [{ path: '/data/markdown', message: 'required field missing' }],
          },
          executionUnits: [],
          artifacts: [],
        }),
      },
    },
  });

  assert.equal(response.run.status, 'failed');
  assert.equal(response.message.status, 'failed');
  assert.match(response.message.content, /ContractValidationFailure\(artifact-schema\)/);
  assert.doesNotMatch(response.message.content, /"contractValidationFailure"/);
  assert.equal(response.executionUnits[0]?.status, 'failed-with-reason');
  assert.deepEqual(response.executionUnits[0]?.recoverActions, ['regenerate report artifact with markdownRef']);
  assert.ok(response.message.objectReferences?.some((reference) => reference.ref === 'execution-unit:EU-report'));
  const raw = response.run.raw as Record<string, unknown>;
  assert.equal((raw.contractValidationFailure as Record<string, unknown>)?.failureReason, 'research-report artifact is missing markdown content.');
});

test('does not synthesize notebook records when backend omits notebook timeline', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '生成 notebook 摘要', {
    ok: true,
    data: {
      run: { id: 'run-no-notebook', status: 'completed' },
      output: {
        message: JSON.stringify({
          message: '后端返回了回答，但没有 notebook timeline。',
          claims: [],
          artifacts: [{ id: 'report-1', type: 'research-report', data: '报告正文' }],
          executionUnits: [{ id: 'EU-1', tool: 'analysis.task', status: 'done', params: '{}' }],
        }),
      },
    },
  });

  assert.deepEqual(response.notebook, []);
});

test('preserves backend-provided UIManifest slots without replacing component ids', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '展示后端视图', {
    ok: true,
    data: {
      run: { id: 'run-ui-manifest', status: 'completed' },
      output: {
        message: JSON.stringify({
          message: '后端提供了视图 manifest。',
          uiManifest: [{
            componentId: 'report-viewer',
            title: 'Backend report',
            props: { dense: true },
            artifactRef: 'artifact:report-1',
            priority: 2,
            encoding: { colorBy: 'confidence' },
            layout: { mode: 'single', height: 420 },
            selection: { id: 'claim-1', values: ['claim-1'] },
            sync: { selectionIds: ['claim-1'] },
            transform: [{ type: 'limit', value: 5 }],
            compare: { artifactRefs: ['artifact:report-2'], mode: 'side-by-side' },
          }],
          artifacts: [{ id: 'report-1', type: 'research-report', data: { markdown: '# Backend' } }],
          executionUnits: [{ id: 'EU-1', tool: 'analysis.task', status: 'done', params: '{}' }],
        }),
      },
    },
  });

  assert.deepEqual(response.uiManifest, [{
    componentId: 'report-viewer',
    title: 'Backend report',
    props: { dense: true },
    artifactRef: 'artifact:report-1',
    priority: 2,
    encoding: { colorBy: 'confidence' },
    layout: { mode: 'single', height: 420 },
    selection: { id: 'claim-1', values: ['claim-1'] },
    sync: { selectionIds: ['claim-1'] },
    transform: [{ type: 'limit', value: 5 }],
    compare: { artifactRefs: ['artifact:report-2'], mode: 'side-by-side' },
  }]);
});

test('does not invent UIManifest component choices or preferred views from artifact semantics', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '展示报告', {
    ok: true,
    data: {
      run: { id: 'run-no-ui-manifest', status: 'completed' },
      output: {
        message: JSON.stringify({
          message: '后端只返回 artifacts，没有 manifest。',
          uiManifest: [{ id: 'paper-card-list', artifactRef: 'papers' }],
          artifacts: [
            { id: 'report-1', type: 'research-report', data: '# Report' },
            { id: 'papers', type: 'paper-list', data: [{ title: 'Paper' }] },
          ],
          objectReferences: [{ ref: 'artifact:report-1', kind: 'artifact', title: 'Report artifact' }],
          executionUnits: [{ id: 'EU-1', tool: 'analysis.task', status: 'done', params: '{}' }],
        }),
      },
    },
  });

  assert.deepEqual(response.uiManifest, []);
  assert.equal(response.artifacts[0]?.data, '# Report');
  assert.equal(response.message.objectReferences?.find((reference) => reference.ref === 'artifact:report-1')?.preferredView, undefined);
  assert.equal(response.message.objectReferences?.find((reference) => reference.ref === 'artifact:papers')?.preferredView, undefined);
});
