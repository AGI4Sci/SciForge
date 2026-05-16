import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectReference, SciForgeMessage, SciForgeSession } from '../../domain';
import { parseSciForgeReferenceAttribute } from '../../../../../packages/support/object-references';
import { MessageContent, inlineObjectReferencesForMessage } from './MessageContent';
import { composerReferenceForObjectReference } from './composerReferences';
import { ObjectReferenceChips } from './ReferenceChips';
import { currentObjectReferenceFromComposerReference } from './composerReferences';

const pickedFile: ObjectReference = {
  id: 'obj-picked-file',
  kind: 'file',
  title: 'Picked methods file',
  ref: 'file:papers/methods.md',
  status: 'available',
  summary: 'explicitly picked file',
  provenance: {
    path: 'papers/methods.md',
    hash: 'sha256-picked-file',
    producer: 'workspace',
  },
};

const recentArtifact: ObjectReference = {
  id: 'obj-recent-artifact',
  kind: 'artifact',
  title: 'Recent report',
  ref: 'artifact:recent-report',
  artifactType: 'research-report',
  status: 'available',
  summary: 'implicit recent artifact',
};

test('message structured object links expose the picked ObjectReference as currentReference payload', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content="基于 file:papers/methods.md 继续。"
      references={[pickedFile, recentArtifact]}
      onObjectFocus={() => undefined}
    />,
  );

  const reference = firstRenderedReference(markup);
  const currentReference = currentObjectReferenceFromComposerReference(reference);
  assert.equal(reference.ref, 'file:papers/methods.md');
  assert.equal(currentReference?.ref, 'file:papers/methods.md');
  assert.equal(currentReference?.provenance?.hash, 'sha256-picked-file');
  assert.match(markup, /Picked methods file/);
  assert.match(markup, /file:papers\/methods\.md/);
});

test('message markdown renderer supports GFM tables while structured object refs stay outside table cells', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content={[
        '| 文件 | 状态 |',
        '| --- | --- |',
        '| file:papers/methods.md | ~~old~~ **ready** |',
      ].join('\n')}
      references={[pickedFile]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /<table>/);
  assert.match(markup, /<del>old<\/del>/);
  assert.match(markup, /<strong>ready<\/strong>/);
  assert.match(markup, /data-sciforge-reference=/);
  assert.match(markup, /Picked methods file/);
});

test('message markdown renderer only renders structured object refs, never text-scanned refs', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content="Use `file:papers/methods.md` as literal text, then open file:papers/methods.md."
      references={[pickedFile]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.equal((markup.match(/data-sciforge-reference=/g) ?? []).length, 1);
});

test('user messages do not display object references produced by later agent work', () => {
  const session = sessionWithObjects({
    runs: [{
      id: 'run-later',
      prompt: '帮我调研一下',
      response: 'done',
      status: 'completed',
      scenarioId: 'literature-evidence-review',
      createdAt: '2026-05-14T00:00:01.000Z',
      objectReferences: [recentArtifact],
    }],
    artifacts: [{
      id: 'recent-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: 'test.runtime-artifact.v1',
      data: {},
      metadata: {
        runId: 'run-later',
        readableRef: 'reports/recent-report.md',
        rawRef: 'reports/recent-report.md',
        previewPolicy: 'inline',
      },
    }],
  });
  const message = userMessage({
    objectReferences: [recentArtifact],
  });

  const references = inlineObjectReferencesForMessage(message, session, 'run-later');

  assert.deepEqual(references, []);
});

test('user messages keep explicitly selected composer references', () => {
  const message = userMessage({
    references: [composerReferenceForObjectReference(pickedFile)],
    objectReferences: [recentArtifact],
  });

  const references = inlineObjectReferencesForMessage(message, sessionWithObjects());

  assert.equal(references.length, 1);
  assert.equal(references[0]?.ref, 'file:papers/methods.md');
});

test('scenario message refs do not become visible from presentation-role filename heuristics', () => {
  const heuristicReportFile: ObjectReference = {
    id: 'obj-heuristic-report',
    kind: 'file',
    title: 'Generated report',
    ref: 'file:reports/generated-report.md',
    status: 'available',
    provenance: { path: 'reports/generated-report.md' },
  };
  const message: SciForgeMessage = {
    id: 'msg-scenario',
    role: 'scenario',
    content: 'Report complete',
    createdAt: '2026-05-14T00:00:01.000Z',
    status: 'completed',
    objectReferences: [heuristicReportFile],
  };

  const references = inlineObjectReferencesForMessage(message, sessionWithObjects());

  assert.deepEqual(references, []);
});

test('scenario message refs can show explicit user-facing file references', () => {
  const explicitEvidenceFile: ObjectReference = {
    id: 'obj-explicit-evidence',
    kind: 'file',
    title: 'Evidence table',
    ref: 'file:reports/evidence.csv',
    status: 'available',
    presentationRole: 'supporting-evidence',
    provenance: { path: 'reports/evidence.csv' },
  };
  const message: SciForgeMessage = {
    id: 'msg-scenario-explicit',
    role: 'scenario',
    content: 'Evidence ready',
    createdAt: '2026-05-14T00:00:01.000Z',
    status: 'completed',
    objectReferences: [explicitEvidenceFile],
  };

  const references = inlineObjectReferencesForMessage(message, sessionWithObjects());

  assert.equal(references.length, 1);
  assert.equal(references[0]?.ref, 'file:reports/evidence.csv');
});

test('object reference chips expose each selected chip object instead of the recent artifact', () => {
  const markup = renderToStaticMarkup(
    <ObjectReferenceChips
      references={[pickedFile, recentArtifact]}
      onFocus={() => undefined}
    />,
  );

  const reference = firstRenderedReference(markup);
  const currentReference = currentObjectReferenceFromComposerReference(reference);
  assert.equal(reference.ref, 'file:papers/methods.md');
  assert.equal(currentReference?.ref, 'file:papers/methods.md');
  assert.equal(currentReference?.id, 'obj-picked-file');
});

function firstRenderedReference(markup: string) {
  const match = markup.match(/data-sciforge-reference="([^"]+)"/);
  assert.ok(match, 'expected rendered data-sciforge-reference attribute');
  const reference = parseSciForgeReferenceAttribute(decodeHtmlAttribute(match[1]));
  assert.ok(reference, 'expected parseable SciForgeReference attribute');
  return reference;
}

function userMessage(overrides: Partial<SciForgeMessage> = {}): SciForgeMessage {
  return {
    id: 'msg-user',
    role: 'user',
    content: '帮我调研一下',
    createdAt: '2026-05-14T00:00:00.000Z',
    status: 'completed',
    ...overrides,
  };
}

function sessionWithObjects(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    id: 'session-test',
    scenarioId: 'literature-evidence-review',
    title: 'Test session',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    messages: [],
    runs: [],
    artifacts: [],
    executionUnits: [],
    claims: [],
    notebook: [],
    uiManifest: [],
    ...overrides,
  } as SciForgeSession;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
