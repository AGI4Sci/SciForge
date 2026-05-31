import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { canHydrateWorkspaceObjectPath, descriptorNeedsManualPreviewLoad, requestManualArtifactPreviewLoad, WorkspaceFileInlineViewer, WorkspaceObjectPreview } from './WorkspaceObjectPreview';
import { MarkdownBlock } from './reportContent';

describe('WorkspaceObjectPreview presentation input', () => {
  it('requires an explicit load action before previewing large descriptor-backed text artifacts', () => {
    assert.equal(descriptorNeedsManualPreviewLoad({
      kind: 'markdown',
      source: 'path',
      ref: '.sciforge/artifacts/large-report.md',
      sizeBytes: 2 * 1024 * 1024,
      inlinePolicy: 'extract',
      actions: ['extract-text'],
    }), true);
    assert.equal(descriptorNeedsManualPreviewLoad({
      kind: 'markdown',
      source: 'path',
      ref: '.sciforge/artifacts/small-report.md',
      sizeBytes: 154,
      inlinePolicy: 'inline',
      actions: ['copy-ref'],
    }), false);
  });

  it('uses markdown delivery refs instead of rendering artifact JSON fallback', () => {
    const artifact: RuntimeArtifact = {
      id: 'report-1',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Recovered report' },
      data: { content: '# JSON envelope should stay hidden' },
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:report-1',
        role: 'primary-deliverable',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
        contentShape: 'raw-file',
        readableRef: '.sciforge/artifacts/report-1.md',
        rawRef: '.sciforge/artifacts/output.json',
        previewPolicy: 'inline',
      },
    };
    const reference: ObjectReference = {
      id: 'obj-report-1',
      title: 'Recovered report',
      kind: 'artifact',
      ref: 'artifact:report-1',
      artifactType: 'research-report',
      status: 'available',
    };

    const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference,
      session: testSession([artifact]),
      config: testConfig(),
    }));

    assert.match(html, /loading/);
    assert.match(html, /\.sciforge\/artifacts\/report-1\.md/);
    assert.doesNotMatch(html, /JSON envelope should stay hidden/);
    assertNoInternalPreviewTerms(html);
  });

  it('routes manual artifact preview requests through UserActionApi before workspace preview hydration', async () => {
    const session = testSession([]);
    const calls: Array<{ artifactRef: string; byteLimit?: number }> = [];
    const result = await requestManualArtifactPreviewLoad({
      session,
      reference: {
        id: 'obj-large-report',
        title: 'Large report',
        kind: 'artifact',
        ref: 'artifact:large-report',
        status: 'available',
      },
      byteLimit: 8192,
      userActionApi: {
        async loadArtifactPreview(input) {
          calls.push({ artifactRef: input.artifactRef, byteLimit: input.byteLimit });
          return {
            artifactRef: input.artifactRef,
            status: 'ready',
            title: input.artifactRef,
            actions: [],
          };
        },
      },
    });

    assert.deepEqual(calls, [{ artifactRef: 'artifact:large-report', byteLimit: 8192 }]);
    assert.equal(result?.artifactRef, 'artifact:large-report');
  });

  it('does not treat non-artifact manual preview requests as artifact actions', async () => {
    const session = testSession([]);
    let called = false;
    const result = await requestManualArtifactPreviewLoad({
      session,
      reference: {
        id: 'file-1',
        title: 'data.csv',
        kind: 'file',
        ref: 'file:workspace/data.csv',
        status: 'available',
      },
      userActionApi: {
        async loadArtifactPreview() {
          called = true;
          throw new Error('file refs should not be routed as artifact preview actions');
        },
      },
    });

    assert.equal(result, undefined);
    assert.equal(called, false);
  });

  it('delegates workspace preview hydration to the functional hydration API', async () => {
    const source = await readFile(join(process.cwd(), 'src/ui/src/app/results/WorkspaceObjectPreview.tsx'), 'utf8');

    assert.match(source, /createWorkspacePreviewHydrationApi/);
    assert.doesNotMatch(source, /readWorkspaceFile\s*\(/);
    assert.doesNotMatch(source, /readPreviewDescriptor\s*\(/);
    assert.doesNotMatch(source, /readPreviewDerivative\s*\(/);
  });

  it('only hydrates safe workspace preview paths', () => {
    assert.equal(canHydrateWorkspaceObjectPath('PROJECT.md'), true);
    assert.equal(canHydrateWorkspaceObjectPath('src/ui/src/app/results/WorkspaceObjectPreview.tsx'), true);
    assert.equal(canHydrateWorkspaceObjectPath('.sciforge/artifacts/report.md'), true);
    assert.equal(canHydrateWorkspaceObjectPath('patches/fix.diff'), true);
    assert.equal(canHydrateWorkspaceObjectPath('.sciforge/artifacts/fix.patch'), true);

    for (const path of [
      '/tmp/private.md',
      '/tmp/fix.patch',
      'C:/repo/PROJECT.md',
      'C:/repo/fix.patch',
      '../secret.md',
      '../fix.patch',
      '~/secret.md',
      '.sciforge/logs/stdout.log',
      '.sciforge/raw/provider.json',
      '.sciforge/raw/fix.patch',
      '.sciforge/audit/fix.patch',
      '.sciforge/logs/stdout.patch',
      '.sciforge/task-results/run.stderr.diff',
      'https://example.test/report.md',
      'bad<name>.md',
      'apiKey=secret.md',
    ]) {
      assert.equal(canHydrateWorkspaceObjectPath(path), false, path);
    }
  });

  it('only renders safe URL preview schemes as links', () => {
    const safeHtml = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference: {
        id: 'obj-url-safe',
        title: 'Docs',
        kind: 'url',
        ref: 'url:https://docs.example.org/guide',
        status: 'available',
      },
      session: testSession([]),
      config: testConfig(),
    }));
    const unsafeHtml = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference: {
        id: 'obj-url-unsafe',
        title: 'Unsafe',
        kind: 'url',
        ref: 'url:javascript:alert(1)',
        status: 'available',
      },
      session: testSession([]),
      config: testConfig(),
    }));

    assert.match(safeHtml, /href="https:\/\/docs\.example\.org\/guide"/);
    assert.doesNotMatch(unsafeHtml, /href=/);
    assert.match(unsafeHtml, /javascript:alert/);
  });

  it('renders unsafe workspace preview paths as a bounded fallback instead of a permanent loading state', () => {
    for (const ref of [
      'file:/tmp/private.md',
      'file:.sciforge/raw/provider.json',
    ]) {
      const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
        reference: {
          id: `obj-${ref.replace(/[^a-z0-9]+/gi, '-')}`,
          title: ref,
          kind: 'file',
          ref,
          status: 'available',
        },
        session: testSession([]),
        config: testConfig(),
      }));

      assert.match(html, /Preview unavailable/);
      assert.match(html, /Preview unavailable/);
      assert.doesNotMatch(html, /正在读取 workspace 文件内容|loading/);
      assert.doesNotMatch(html, /\/tmp\/private|\.sciforge\/raw\/provider/);
      assertNoInternalPreviewTerms(html);
    }
  });

  it('redacts URL preview titles and sensitive URL text', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference: {
        id: 'obj-url-sensitive',
        title: sensitiveTitle('url'),
        kind: 'url',
        ref: 'url:https://provider.example.test/v1/chat/completions?api_key=sk-url-secret-1234567890',
        status: 'available',
      },
      session: testSession([]),
      config: testConfig(),
    }));

    assertNoSensitiveTitleLeak(html);
    assert.doesNotMatch(html, /href=/);
    assert.match(html, /redacted-url|redacted-secret|redacted-local-path/);
  });

  it('redacts inline preview titles in headers and media attributes', () => {
    const artifact: RuntimeArtifact = {
      id: 'inline-image',
      type: 'plot',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: sensitiveTitle('inline') },
      data: {
        previewKind: 'image',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
        mimeType: 'image/png',
      },
    };
    const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference: {
        id: 'obj-inline-image',
        title: 'Inline image',
        kind: 'artifact',
        ref: 'artifact:inline-image',
        artifactType: 'plot',
        status: 'available',
      },
      session: testSession([artifact]),
      config: testConfig(),
    }));

    assertNoSensitiveTitleLeak(html);
    assert.match(html, /alt="[^"]*redacted/);
  });

  it('redacts unavailable preview artifact metadata titles', () => {
    const artifact: RuntimeArtifact = {
      id: 'unavailable-title',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: sensitiveTitle('preview') },
    };
    const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference: {
        id: 'obj-unavailable-title',
        title: 'Preview report',
        kind: 'artifact',
        ref: 'artifact:unavailable-title',
        artifactType: 'research-report',
        status: 'available',
      },
      session: testSession([artifact]),
      config: testConfig(),
    }));

    assertNoSensitiveTitleLeak(html);
    assert.match(html, /Preview unavailable/);
    assert.match(html, /redacted-url|redacted-secret|redacted-local-path/);
    assert.doesNotMatch(html, /artifact:unavailable-title|research-report/);
    assertNoInternalPreviewTerms(html);
  });

  it('renders sub-agent result and transcript refs from saved process events without raw JSON fallback', () => {
    const run: SciForgeRun = {
      id: 'run-subagent',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'call multi_agent_v1.spawn_agent once',
      response: 'done',
      createdAt: '2026-05-30T00:00:00.000Z',
      completedAt: '2026-05-30T00:00:01.000Z',
      raw: {
        streamProcess: {
          events: [{
            type: 'tool_completed',
            createdAt: '2026-05-30T00:00:01.000Z',
            native: {
              toolName: 'multi_agent_v1.spawn_agent',
              status: 'completed',
              agentId: 'worker-abc123',
              parentAgentId: 'codex-command-1',
              ref: 'artifact:subagent-result-abc123',
              transcriptRef: 'artifact:subagent-transcript-abc123',
              resultSummary: 'Read-only delegated worker completed. Read only. read PROJECT.md only. Sub agent reads PROJECT.md. Main agent summarize. Request summary: call multi_agent_v1.spawn_agent once. Do not use shell substitute. ... ll substitute. Remaining live parity TODO: sub-agent transcript ref evidence.',
              refs: [
                'artifact:subagent-result-abc123',
                'artifact:subagent-transcript-abc123',
                'file:PROJECT.md',
                'trace:unsafe-subagent',
                'audit:codex-runtime:run-1:raw-events',
                'file:.sciforge/raw/provider.json',
              ],
              outputSummary: '{"ok":true,"raw":"should stay hidden"}',
            },
          }],
        },
      },
    };
    const reference: ObjectReference = {
      id: 'obj-subagent-result',
      title: 'artifact:subagent-result-abc123',
      kind: 'artifact',
      ref: 'artifact:subagent-result-abc123',
      status: 'available',
    };

    const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference,
      session: testSession([], [run]),
      config: testConfig(),
    }));

    assert.match(html, /Subtask result/);
    assert.doesNotMatch(html, /worker-abc123/);
    assert.match(html, /Remaining live parity TODO/);
    assert.match(html, /artifact:subagent-transcript-abc123/);
    assert.match(html, /title="artifact:subagent-transcript-abc123"/);
    assert.match(html, /file:PROJECT\.md/);
    assert.ok(html.indexOf('artifact:subagent-result-abc123') < html.indexOf('Remaining live parity TODO'));
    assert.ok(html.indexOf('artifact:subagent-transcript-abc123') < html.indexOf('Remaining live parity TODO'));
    assert.ok(html.indexOf('file:PROJECT.md') < html.indexOf('Remaining live parity TODO'));
    assert.doesNotMatch(html, /Request summary|call multi_agent_v1|Do not use shell substitute|ll substitute|read PROJECT\.md only|Read only|Sub agent reads|Main agent summarize/);
    assert.doesNotMatch(html, /should stay hidden|trace:unsafe-subagent|audit:codex-runtime|\.sciforge\/raw/);
    assert.doesNotMatch(html, /缺少可读取的 workspace 文件路径/);
    assertNoInternalPreviewTerms(html);
  });

  it('redacts binary and unsupported presentation input titles', () => {
    const cases: RuntimeArtifact[] = [
      {
        id: 'deck-binary',
        type: 'presentation',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { title: sensitiveTitle('binary') },
        delivery: {
          contractId: 'sciforge.artifact-delivery.v1',
          ref: 'artifact:deck-binary',
          role: 'primary-deliverable',
          declaredMediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          declaredExtension: 'pptx',
          contentShape: 'binary-ref',
          readableRef: '/Users/alice/private/provider.example.deck.pptx',
          previewPolicy: 'open-system',
        },
      },
      {
        id: 'deck-unsupported',
        type: 'presentation',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { title: sensitiveTitle('unsupported') },
        delivery: {
          contractId: 'sciforge.artifact-delivery.v1',
          ref: 'artifact:deck-unsupported',
          role: 'primary-deliverable',
          declaredMediaType: 'application/x-provider.example',
          declaredExtension: 'provider',
          contentShape: 'raw-file',
          readableRef: '/Users/alice/private/provider.example.deck',
          previewPolicy: 'inline',
        },
      },
    ];

    for (const artifact of cases) {
      const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
        reference: {
          id: `obj-${artifact.id}`,
          title: artifact.id,
          kind: 'artifact',
          ref: `artifact:${artifact.id}`,
          artifactType: artifact.type,
          status: 'available',
        },
        session: testSession([artifact]),
        config: testConfig(),
      }));

      assertNoSensitiveTitleLeak(html);
      assert.match(html, /Open externally|Preview unavailable/);
      assert.match(html, /redacted-url|redacted-secret|redacted-local-path/);
      assertNoInternalPreviewTerms(html);
    }
  });

  it('renders markdown reports with GFM tables and task lists', () => {
    const html = renderToStaticMarkup(createElement(MarkdownBlock, {
      markdown: [
        '# Report',
        '',
        '| Paper | Status |',
        '| --- | --- |',
        '| A | **read** |',
        '',
        '- [x] summarized',
      ].join('\n'),
    }));

    assert.match(html, /<table>/);
    assert.match(html, /<th>Paper<\/th>/);
    assert.match(html, /<strong>read<\/strong>/);
    assert.match(html, /type="checkbox"/);
  });

  it('upgrades resolvable markdown refs inside workspace preview reports', () => {
    const reportRef: ObjectReference = {
      id: 'obj-report-file',
      kind: 'file',
      title: 'Generated report',
      ref: 'file:reports/generated-report.md',
      status: 'available',
      provenance: { path: 'reports/generated-report.md' },
    };
    const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
      file: {
        path: 'reports/generated-report.md',
        name: 'generated-report.md',
        content: 'Open `generated-report.md` and keep `missing-report.md` literal.',
        size: 72,
        language: 'markdown',
        encoding: 'utf8',
        mimeType: 'text/markdown',
      },
      objectReferences: [reportRef],
      onObjectReferenceFocus: () => undefined,
    }));

    assert.equal((html.match(/data-sciforge-reference=/g) ?? []).length, 1);
    assert.match(html, /markdown-object-ref/);
    assert.match(html, /Generated report/);
    assert.match(html, /<code>missing-report\.md<\/code>/);
  });

  it('redacts sensitive JSON preview text and keeps long workspace content bounded', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
      file: {
        path: 'reports/provider-output.json',
        name: 'provider-output.json',
        content: JSON.stringify({
          authorization: 'Bearer sk-json-secret-1234567890',
          endpoint: 'https://provider.example.test/v1?api_key=abc123',
          localPath: '/Users/alice/private/config.local.json',
          rawProviderPayload: { body: 'RAW_PROVIDER_BODY_SHOULD_NOT_RENDER' },
          artifactRef: 'artifact:safe-table',
          text: 'x'.repeat(13_000),
        }),
        size: 13_400,
        language: 'json',
        encoding: 'utf8',
        mimeType: 'application/json',
      },
    }));

    assert.doesNotMatch(html, /sk-json-secret|provider\.example|api_key=abc123|\/Users\/alice|RAW_PROVIDER_BODY/);
    assert.match(html, /redacted-secret|redacted-url|right-pane-sensitive-object|preview truncated/);
    assert.match(html, /artifact:safe-table/);
  });

  it('renders diff and patch files as bounded sanitized text', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
      file: {
        path: 'patches/fix.patch',
        name: 'fix.patch',
        content: [
          '--- /tmp/private/old.ts',
          '+++ src/app.ts',
          '@@ -1 +1 @@',
          '-const token = sk-diff-secret-1234567890;',
          '+const token = "ok";',
          '.sciforge/audit/raw-output.json',
        ].join('\n'),
        size: 180,
        language: 'patch',
        encoding: 'utf8',
        mimeType: 'text/x-patch',
      },
    }));

    assert.match(html, /workspace-object-diff/);
    assert.match(html, /@@ -1 \+1 @@/);
    assert.doesNotMatch(html, /\/tmp\/private|sk-diff-secret|\.sciforge\/audit\/raw-output/);
    assert.match(html, /redacted-local-path|redacted-secret|redacted-audit-ref/);
  });

  it('keeps workspace image and PDF binary previews ref-first instead of data-url inline', () => {
    const cases = [{
      label: 'image',
      file: {
        path: 'figures/provider-plot.png',
        name: 'provider-plot.png',
        content: 'aW1hZ2UtYmluYXJ5',
        size: 16,
        language: 'image',
        encoding: 'base64' as const,
        mimeType: 'image/png',
      },
      expectedCopy: /Copy image reference/,
      forbidden: /data:image|<img\b|aW1hZ2UtYmluYXJ5/i,
    }, {
      label: 'pdf',
      file: {
        path: 'papers/provider-paper.pdf',
        name: 'provider-paper.pdf',
        content: 'JVBERi0xLjQKc2VjcmV0',
        size: 20,
        language: 'pdf',
        encoding: 'base64' as const,
        mimeType: 'application/pdf',
      },
      expectedCopy: /Copy PDF reference/,
      forbidden: /data:application\/pdf|<object\b|<iframe\b|JVBERi0xLjQKc2VjcmV0/i,
    }];

    for (const { label, file, expectedCopy, forbidden } of cases) {
      const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, { file }));

      assert.match(html, /data-sciforge-reference=/, label);
      assert.match(html, new RegExp(file.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), label);
      assert.match(html, expectedCopy, label);
      assert.doesNotMatch(html, forbidden, label);
      assertNoInternalPreviewTerms(html);
    }
  });

  it('renders system-open notice for binary deliveries', () => {
    const artifact: RuntimeArtifact = {
      id: 'paper-pdf',
      type: 'research-paper',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Paper PDF' },
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:paper-pdf',
        role: 'primary-deliverable',
        declaredMediaType: 'application/pdf',
        declaredExtension: 'pdf',
        contentShape: 'binary-ref',
        readableRef: '.sciforge/artifacts/paper.pdf',
        previewPolicy: 'open-system',
      },
    };
    const reference: ObjectReference = {
      id: 'obj-paper-pdf',
      title: 'Paper PDF',
      kind: 'artifact',
      ref: 'artifact:paper-pdf',
      artifactType: 'research-paper',
      status: 'available',
    };

    const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference,
      session: testSession([artifact]),
      config: testConfig(),
    }));

    assert.match(html, /Open externally/);
    assert.match(html, /system app/);
    assert.match(html, /\.sciforge\/artifacts\/paper\.pdf/);
    assertNoInternalPreviewTerms(html);
  });
});

function testSession(artifacts: RuntimeArtifact[], runs: SciForgeRun[] = []): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: 'Test session',
    messages: [],
    artifacts,
    claims: [],
    notebook: [],
    runs,
    uiManifest: [],
    executionUnits: [],
    versions: [],
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
  };
}

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    workspacePath: '/tmp/ws',
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    requestTimeoutMs: 1000,
    maxContextWindowTokens: 200000,
    visionAllowSharedSystemInput: true,
    updatedAt: '2026-05-12T00:00:00.000Z',
  };
}

function sensitiveTitle(label: string) {
  return `${label} https://provider.example.test/v1 Authorization: Bearer sk-${label}-secret-1234567890 /Users/alice/private/key.txt`;
}

function assertNoSensitiveTitleLeak(html: string) {
  assert.doesNotMatch(html, /provider\.example/i);
  assert.doesNotMatch(html, /\bBearer\b/i);
  assert.doesNotMatch(html, /sk-(?:url|inline|fallback|preview|binary|unsupported)-secret/i);
  assert.doesNotMatch(html, /\/Users\/alice/i);
}

function assertNoInternalPreviewTerms(html: string) {
  assert.doesNotMatch(html, /\bfallback\b/i);
  assert.doesNotMatch(html, /workspace descriptor/i);
  assert.doesNotMatch(html, /LLM token/i);
  assert.doesNotMatch(html, /agent:/i);
  assert.doesNotMatch(html, /parent:/i);
  assert.doesNotMatch(html, /审计/);
}
