import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../domain';
import { WorkspaceObjectPreview } from './WorkspaceObjectPreview';
import { MarkdownBlock } from './reportContent';

describe('WorkspaceObjectPreview presentation input', () => {
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
