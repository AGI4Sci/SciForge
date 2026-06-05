import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectReference } from '../../domain';
import { parseSciForgeReferenceAttribute } from '../../../../../packages/support/object-references';
import { currentObjectReferenceFromComposerReference } from './composerReferences';
import { FinalMessageContent } from './FinalMessageContent';

test('final message exposes bounded public process refs as typed run refs', () => {
  const html = renderToStaticMarkup(
    <FinalMessageContent
      content="Review the child-agent work."
      references={[]}
      resultPresentation={{
        inlineCitations: [
          {
            id: 'cite-child-result',
            label: 'Explorer child result',
            ref: 'subagent:explorer-1',
            kind: 'run',
            summary: 'Found the relevant public files.',
            presentationRole: 'supporting-evidence',
          },
          {
            id: 'cite-child-trace',
            label: 'Trace summary',
            ref: 'trace:explorer-summary',
            kind: 'run',
            summary: 'Folded public trace summary.',
            presentationRole: 'supporting-evidence',
          },
          {
            id: 'cite-parent-run',
            label: 'Parent run',
            ref: 'run:parent-1',
            kind: 'run',
            summary: 'Parent turn process summary.',
            presentationRole: 'supporting-evidence',
          },
          {
            id: 'cite-secret-child',
            label: 'Secret child',
            ref: 'subagent:worker-secret-token',
            kind: 'run',
            presentationRole: 'supporting-evidence',
          },
          {
            id: 'cite-provider-trace',
            label: 'Provider trace',
            ref: 'trace:provider-route',
            kind: 'run',
            summary: 'provider=https://provider.example.invalid token=sk-secret',
            presentationRole: 'supporting-evidence',
          },
        ],
      }}
      onObjectFocus={() => undefined}
    />,
  );

  const references = renderedCurrentObjectReferences(html);

  assert.deepEqual(
    references.map((reference) => [reference.ref, reference.kind]),
    [
      ['subagent:explorer-1', 'run'],
      ['trace:explorer-summary', 'run'],
      ['run:parent-1', 'run'],
    ],
  );
  assert.match(html, /Explorer child result/);
  assert.match(html, /Trace summary/);
  assert.match(html, /Parent run/);
  assert.doesNotMatch(html, /Secret child|worker-secret-token|Provider trace|provider-route|provider\.example|sk-secret/i);
});

function renderedCurrentObjectReferences(markup: string): ObjectReference[] {
  return [...markup.matchAll(/data-sciforge-reference="([^"]+)"/g)]
    .map((match) => {
      const parsed = parseSciForgeReferenceAttribute(decodeHtmlAttribute(match[1] ?? ''));
      return parsed ? currentObjectReferenceFromComposerReference(parsed) : undefined;
    })
    .filter((reference): reference is ObjectReference => Boolean(reference));
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
