import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../domain';
import { WorkspaceObjectPreview } from './WorkspaceObjectPreview';

describe('WorkspaceObjectPreview stale artifact fallback', () => {
  it('renders a readable fallback when an artifact has no workspace path or dataRef', () => {
    const artifact: RuntimeArtifact = {
      id: 'report-1',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Recovered report' },
      data: { markdown: '# Inline fallback\n\nThe file ref is stale, but payload remains readable.' },
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

    assert.match(html, /fallback/);
    assert.match(html, /可读 inline payload/);
    assert.match(html, /Inline fallback/);
    assert.match(html, /artifact:report-1/);
  });

  it('prefers inline artifact data over eager hydration of a potentially stale dataRef', () => {
    const artifact: RuntimeArtifact = {
      id: 'bad-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      dataRef: '.sciforge/artifacts/no-such.md',
      metadata: { title: 'Bad report' },
      data: { markdown: '# Probe\n\nInline report body is still available.' },
    };
    const reference: ObjectReference = {
      id: 'obj-bad-report',
      title: 'Bad report',
      kind: 'artifact',
      ref: 'artifact:bad-report',
      artifactType: 'research-report',
      status: 'available',
    };

    const html = renderToStaticMarkup(createElement(WorkspaceObjectPreview, {
      reference,
      session: testSession([artifact]),
      config: testConfig(),
    }));

    assert.match(html, /可读 inline payload/);
    assert.match(html, /Inline report body is still available/);
    assert.match(html, /\.sciforge\/artifacts\/no-such\.md/);
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
