import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../domain';
import { descriptorNeedsManualPreviewLoad, requestManualArtifactPreviewLoad, WorkspaceFileInlineViewer, WorkspaceObjectPreview } from './WorkspaceObjectPreview';
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
    assert.doesNotMatch(html, /fallback/);
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

    assert.match(html, /binary/);
    assert.match(html, /系统默认程序打开/);
    assert.match(html, /\.sciforge\/artifacts\/paper\.pdf/);
  });
});

function testSession(artifacts: RuntimeArtifact[]): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: 'Test session',
    messages: [],
    artifacts,
    claims: [],
    notebook: [],
    runs: [],
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
