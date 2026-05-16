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

test('summarizes raw backend failure payloads without leaking response body or refs into chat text', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '生成报告', {
    ok: true,
    data: {
      run: {
        id: 'run-raw-backend-failure',
        status: 'failed',
        output: {
          result: JSON.stringify({
            status: 'failed',
            finalText: 'HTTP 401 Unauthorized: Invalid token for https://api.example.invalid/v1/chat stdoutRef=.sciforge/logs/stdout.log stderrRef=.sciforge/logs/stderr.log',
            runtimeEventsRef: '.sciforge/sessions/session-a/runtime-events.json',
          }),
        },
      },
    },
  });

  assert.match(response.message.content, /后端运行未完成：HTTP 401 Unauthorized/);
  assert.doesNotMatch(response.message.content, /Invalid token|https?:\/\/|stdoutRef|stderrRef|runtimeEventsRef|^\{/);
  assert.equal(response.run.response, response.message.content);
});

test('prefers Projection visible answer over stale backend wrapper failure text', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '继续上一轮', {
    ok: true,
    displayIntent: {
      conversationProjection: {
        visibleAnswer: {
          status: 'satisfied',
          text: '已基于当前 artifact 总结两个风险。',
          artifactRefs: ['artifact:risk-summary'],
        },
      },
    },
    data: {
      run: {
        id: 'run-projection-satisfied-wrapper-failed',
        status: 'failed',
        output: {
          error: 'HTTP 500 backend failure from https://api.example.invalid/private stdoutRef=.sciforge/logs/stdout.log',
        },
      },
    },
  });

  assert.equal(response.message.content, '已基于当前 artifact 总结两个风险。');
  assert.equal(response.run.response, '已基于当前 artifact 总结两个风险。');
  assert.doesNotMatch(response.message.content, /HTTP|api\.example|stdoutRef|backend failure/);
  const raw = response.run.raw as Record<string, unknown>;
  const displayIntent = raw.displayIntent as Record<string, unknown>;
  const projection = displayIntent.conversationProjection as Record<string, unknown>;
  assert.equal((projection.visibleAnswer as Record<string, unknown>).text, '已基于当前 artifact 总结两个风险。');
});

test('prefers satisfied Projection over stale ContractValidationFailure diagnostics', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '继续上一轮', {
    ok: true,
    data: {
      run: {
        id: 'run-projection-satisfied-stale-contract-failure',
        status: 'failed',
        output: {
          result: JSON.stringify({
            contractValidationFailure: {
              contract: 'sciforge.contract-validation-failure.v1',
              schemaPath: '/artifacts/0/data',
              contractId: 'research-report.v1',
              capabilityId: 'report-viewer',
              failureKind: 'artifact-schema',
              failureReason: 'stale wrapper failure after Projection was already satisfied.',
              recoverActions: ['rerun stale wrapper'],
              nextStep: 'Ignore stale diagnostic for the main result.',
              relatedRefs: ['artifact:stale-wrapper'],
              issues: [{ path: '/data/markdown', message: 'stale required field missing' }],
            },
            displayIntent: {
              conversationProjection: {
                visibleAnswer: {
                  status: 'satisfied',
                  text: 'Projection answer wins and remains the user-visible terminal result.',
                  artifactRefs: ['artifact:current-report'],
                },
              },
            },
            executionUnits: [],
            artifacts: [],
          }),
        },
      },
    },
  });

  assert.equal(response.run.status, 'completed');
  assert.equal(response.message.status, 'completed');
  assert.equal(response.message.content, 'Projection answer wins and remains the user-visible terminal result.');
  assert.equal(response.run.response, 'Projection answer wins and remains the user-visible terminal result.');
  assert.doesNotMatch(response.message.content, /ContractValidationFailure|stale wrapper|rerun stale/);
  const raw = response.run.raw as Record<string, unknown>;
  assert.equal((raw.contractValidationFailure as Record<string, unknown>)?.failureReason, 'stale wrapper failure after Projection was already satisfied.');
});

test('prefers Projection visible answer from parsed ToolPayload JSON output', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '生成备忘录', {
    ok: true,
    data: {
      run: {
        id: 'run-json-toolpayload-projection',
        status: 'completed',
        output: {
          result: JSON.stringify({
            message: '已生成备忘录。',
            reasoningTrace: 'stdoutRef=.sciforge/logs/stdout.log stderrRef=.sciforge/logs/stderr.log',
            displayIntent: {
              conversationProjection: {
                visibleAnswer: {
                  status: 'satisfied',
                  text: '已生成备忘录。',
                  artifactRefs: ['artifact:memo'],
                },
              },
            },
            claims: [],
            uiManifest: [],
            executionUnits: [],
            artifacts: [{ id: 'memo', type: 'research-report', title: 'Memo', dataRef: '.sciforge/task-results/memo.md' }],
          }),
        },
      },
    },
  });

  assert.equal(response.message.content, '已生成备忘录。');
  assert.equal(response.run.response, '已生成备忘录。');
  assert.doesNotMatch(response.message.content, /stdoutRef|stderrRef|^\{/);
});

test('summarizes output.error backend failures without leaking endpoint text', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '生成报告', {
    ok: true,
    data: {
      run: {
        id: 'run-output-error',
        status: 'failed',
        output: {
          error: 'HTTP 403 Forbidden from https://api.example.invalid/private?token=secret-token',
        },
      },
    },
  });

  assert.match(response.message.content, /后端运行未完成：HTTP 403 Forbidden/);
  assert.doesNotMatch(response.message.content, /api\.example|secret-token|https?:\/\//);
});

test('natural failed answers remain visible when they are not raw transport diagnostics', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '生成报告', {
    ok: true,
    data: {
      run: {
        id: 'run-natural-failure',
        status: 'failed',
        output: {
          message: '没有找到满足条件的文献，因此无法生成报告。请放宽年份条件后重试。',
        },
      },
    },
  });

  assert.match(response.message.content, /没有找到满足条件的文献/);
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

test('binds backend execution units without runId to the normalized UI run', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '导出审计包', {
    ok: true,
    data: {
      run: { id: 'run-ui-owned-audit', status: 'completed' },
      output: {
        message: JSON.stringify({
          message: '审计包已准备好。',
          artifacts: [{ id: 'audit-report', type: 'audit-summary', dataRef: '.sciforge/sessions/2026-05-15_lit_session/artifacts/audit.md' }],
          executionUnits: [{
            id: 'EU-audit-export',
            tool: 'python',
            status: 'done',
            params: 'python export_audit.py',
            stdoutRef: 'file:.sciforge/sessions/2026-05-15_lit_session/logs/stdout.log',
            stderrRef: 'file:.sciforge/sessions/2026-05-15_lit_session/logs/stderr.log',
            verificationRef: '.sciforge/sessions/2026-05-15_lit_session/verifications/verdict.json',
          }],
        }),
      },
    },
  });

  assert.equal(response.run.id, 'run-ui-owned-audit');
  assert.equal(response.executionUnits[0]?.runId, 'run-ui-owned-audit');
});
