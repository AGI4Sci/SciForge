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

test('message content renders uploaded image object refs as clickable ref-first thumbnails', () => {
  const uploadedImage: ObjectReference = {
    id: 'obj-upload-image-1',
    kind: 'artifact',
    title: 'microscopy.png',
    ref: 'artifact:upload-image-1',
    artifactType: 'uploaded-image',
    preferredView: 'preview',
    presentationRole: 'supporting-evidence',
    status: 'available',
    summary: 'Uploaded image',
    provenance: {
      path: '.sciforge/uploads/session-1/upload-image-1-microscopy.png',
      dataRef: '.sciforge/uploads/session-1/upload-image-1-microscopy.png',
      producer: 'user-upload',
      size: 2048,
    },
  };
  const markup = renderToStaticMarkup(
    <MessageContent
      content="What does this show?"
      references={[uploadedImage]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /message-image-attachments/);
  assert.match(markup, /<img/);
  assert.match(markup, /src="\/api\/sciforge\/preview\/raw\?ref=\.sciforge%2Fuploads%2Fsession-1%2Fupload-image-1-microscopy\.png"/);
  assert.match(markup, /data-sciforge-reference=/);
  assert.doesNotMatch(markup, /data:image|base64|iVBORw0KGgo/i);
});

test('message image thumbnails resolve through configured workspace writer and workspace path', () => {
  const uploadedImage: ObjectReference = {
    id: 'obj-upload-image-writer-preview',
    kind: 'artifact',
    title: 'microscopy.png',
    ref: 'artifact:upload-image-writer-preview',
    artifactType: 'uploaded-image',
    preferredView: 'preview',
    presentationRole: 'supporting-evidence',
    status: 'available',
    provenance: {
      path: '.sciforge/uploads/session-1/upload-image-1-microscopy.png',
      dataRef: '.sciforge/uploads/session-1/upload-image-1-microscopy.png',
      producer: 'user-upload',
    },
  };
  const markup = renderToStaticMarkup(
    <MessageContent
      content="What does this show?"
      references={[uploadedImage]}
      previewConfig={{
        workspaceWriterBaseUrl: 'http://127.0.0.1:6173/',
        workspacePath: '/tmp/sciforge workspace',
      }}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /src="http:\/\/127\.0\.0\.1:6173\/api\/sciforge\/preview\/raw\?ref=\.sciforge%2Fuploads%2Fsession-1%2Fupload-image-1-microscopy\.png&amp;workspacePath=%2Ftmp%2Fsciforge\+workspace"/);
});

test('message markdown turns auto-linked uploaded image filenames into object ref buttons', () => {
  const uploadedImage: ObjectReference = {
    id: 'obj-upload-image-autolink',
    kind: 'artifact',
    title: 'WX20260605-091908@2x.png',
    ref: 'artifact:upload-image-autolink',
    artifactType: 'uploaded-image',
    preferredView: 'preview',
    presentationRole: 'supporting-evidence',
    status: 'available',
    provenance: {
      path: '.sciforge/uploads/session-1/upload-image-WX20260605-091908@2x.png',
      dataRef: '.sciforge/uploads/session-1/upload-image-WX20260605-091908@2x.png',
      producer: 'user-upload',
    },
  };
  const markup = renderToStaticMarkup(
    <MessageContent
      content="已上传 1 个文件作为引用：WX20260605-091908@2x.png"
      references={[uploadedImage]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /markdown-object-ref message-object-link/);
  assert.match(markup, /data-sciforge-reference=/);
  assert.doesNotMatch(markup, /mailto:WX20260605-091908@2x\.png/);
});

test('message markdown renderer supports complete assistant markdown without raw html', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content={[
        '# Evaluation Plan',
        '',
        '中文和 English terms should stay readable with inline math-like symbols z_t and W_2 plus inline LaTeX $z_t = W_2 + \\alpha$.',
        '',
        '$$',
        '\\hat{z}_{t+\\Delta}=z_t+\\alpha(\\Delta)R_\\theta(z_t)',
        '$$',
        '',
        '## Checklist',
        '- Data',
        '  - perturbation labels',
        '  - held-out cell types',
        '1. Score generalization.',
        '2. Review calibration.',
        '',
        '| Metric | Use | Caveat |',
        '| --- | --- | --- |',
        '| MSE | regression | scale-sensitive |',
        '',
        '> Keep the biological question attached to the benchmark.',
        '',
        '```ts',
        'const score: number = 0.92;',
        '```',
        '',
        'Read [arXiv](https://arxiv.org) for public preprints.',
        '',
        '<section>RAW_HTML_SHOULD_NOT_RENDER</section>',
      ].join('\n')}
      references={[]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /<h1>Evaluation Plan<\/h1>/);
  assert.match(markup, /<h2>Checklist<\/h2>/);
  assert.match(markup, /<ul>/);
  assert.match(markup, /<ol>/);
  assert.match(markup, /<table>/);
  assert.match(markup, /<blockquote>/);
  assert.match(markup, /<pre>/);
  assert.match(markup, /class="language-ts"/);
  assert.match(markup, /href="https:\/\/arxiv\.org"/);
  assert.match(markup, /z_t/);
  assert.match(markup, /W_2/);
  assert.match(markup, /class="katex/);
  assert.match(markup, /katex-display/);
  assert.doesNotMatch(markup, /\$z_t|\$\$/);
  assert.doesNotMatch(markup, /RAW_HTML_SHOULD_NOT_RENDER|<section>/);
});

test('message markdown renderer preserves literal dollars and code math text', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content={[
        'A price like $5 and a p-value like p < 0.05 should stay prose.',
        '',
        'Inline code keeps `$x+y$` literal.',
        '',
        '```md',
        '$$',
        'x+y',
        '$$',
        '```',
        '',
        'Real math still renders: $x+y$.',
      ].join('\n')}
      references={[]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /A price like \$5/);
  assert.match(markup, /p &lt; 0\.05/);
  assert.match(markup, /<code>\$x\+y\$<\/code>/);
  assert.match(markup, /<pre><code class="language-md">\$\$\nx\+y\n\$\$/);
  assert.match(markup, /class="katex/);
});

test('message markdown renderer disables unsafe markdown link protocols', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content={[
        '[unsafe js](javascript:alert(1))',
        '[unsafe data](data:text/html;base64,PHNjcmlwdD4=)',
        '[safe](https://example.org/path?q=1)',
      ].join('\n\n')}
      references={[]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.doesNotMatch(markup, /href="javascript:|href="data:/i);
  assert.match(markup, /markdown-disabled-link/);
  assert.match(markup, /href="https:\/\/example\.org\/path\?q=1"/);
});

test('message markdown renderer keeps CJK punctuation outside autolink literals and object refs', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content={[
        '参考 https://example.org、再看 https://example.com/path，最后 https://example.net/a；以及 https://example.edu/b：说明 https://example.edu/c！',
        '继续 https://example.edu/d？收尾 https://example.edu/e）与 https://example.edu/f】。',
        '显式链接 [explicit](https://example.net/explicit)。',
        '对象引用 file:papers/methods.md，和 file:papers/methods.md）都应保留标点在按钮外。',
      ].join('\n\n')}
      references={[pickedFile]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.match(markup, /href="https:\/\/example\.org"/);
  assert.match(markup, /href="https:\/\/example\.com\/path"/);
  assert.match(markup, /href="https:\/\/example\.net\/a"/);
  assert.match(markup, /href="https:\/\/example\.edu\/b"/);
  assert.match(markup, /href="https:\/\/example\.edu\/c"/);
  assert.match(markup, /href="https:\/\/example\.edu\/d"/);
  assert.match(markup, /href="https:\/\/example\.edu\/e"/);
  assert.match(markup, /href="https:\/\/example\.edu\/f"/);
  assert.match(markup, /href="https:\/\/example\.net\/explicit"/);
  assert.match(markup, />https:\/\/example\.org<\/a>、再看/);
  assert.match(markup, />https:\/\/example\.com\/path<\/a>，最后/);
  assert.match(markup, />https:\/\/example\.net\/a<\/a>；以及/);
  assert.match(markup, />https:\/\/example\.edu\/b<\/a>：说明/);
  assert.match(markup, />https:\/\/example\.edu\/c<\/a>！/);
  assert.match(markup, />https:\/\/example\.edu\/d<\/a>？收尾/);
  assert.match(markup, />https:\/\/example\.edu\/e<\/a>）与/);
  assert.match(markup, />https:\/\/example\.edu\/f<\/a>】。/);
  assert.match(markup, /file:papers\/methods\.md<\/button>，/);
  assert.match(markup, /file:papers\/methods\.md<\/button>）/);
  assert.doesNotMatch(markup, /href="[^"]*%(?:E3%80%81|EF%BC%8C|E3%80%82|EF%BC%9B|EF%BC%9A|EF%BC%81|EF%BC%9F|EF%BC%89|E3%80%91)/);
});

test('message markdown renderer upgrades resolvable inline code and explicit prose refs', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content="Use `file:papers/methods.md` as literal text, then open file:papers/methods.md."
      references={[pickedFile]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.equal((markup.match(/data-sciforge-reference=/g) ?? []).length, 2);
  assert.match(markup, /<button[^>]+markdown-object-ref/);
});

test('message markdown renderer keeps unresolved explicit prose refs as plain text', () => {
  const markup = renderToStaticMarkup(
    <MessageContent
      content="Open artifact:missing-report and keep it as plain text."
      references={[pickedFile]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.equal((markup.match(/data-sciforge-reference=/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /artifact:missing-report[^<]*<\/button>/);
  assert.match(markup, /artifact:missing-report/);
  assert.match(markup, /Picked methods file/);
});

test('message markdown renderer links unique bare filenames and leaves ambiguous code alone', () => {
  const duplicateA: ObjectReference = {
    ...pickedFile,
    id: 'obj-duplicate-a',
    title: 'Duplicate A',
    ref: 'file:alpha/shared-report.md',
    provenance: { path: 'alpha/shared-report.md' },
  };
  const duplicateB: ObjectReference = {
    ...pickedFile,
    id: 'obj-duplicate-b',
    title: 'Duplicate B',
    ref: 'file:beta/shared-report.md',
    provenance: { path: 'beta/shared-report.md' },
  };
  const markup = renderToStaticMarkup(
    <MessageContent
      content="Open `methods.md`; keep `shared-report.md` and `missing-report.md` as code."
      references={[pickedFile, duplicateA, duplicateB]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.equal((markup.match(/data-sciforge-reference=/g) ?? []).length, 1);
  assert.match(markup, /methods\.md/);
  assert.match(markup, /<code>shared-report\.md<\/code>/);
  assert.match(markup, /<code>missing-report\.md<\/code>/);
});

test('message markdown renderer does not resolve ambiguous bare filenames by shared title', () => {
  const duplicateA: ObjectReference = {
    ...pickedFile,
    id: 'obj-duplicate-title-a',
    title: 'duplicate_inline_ref.md',
    ref: 'file:alpha/duplicate_inline_ref.md',
    provenance: { path: 'alpha/duplicate_inline_ref.md' },
  };
  const duplicateB: ObjectReference = {
    ...pickedFile,
    id: 'obj-duplicate-title-b',
    title: 'duplicate_inline_ref.md',
    ref: 'file:beta/duplicate_inline_ref.md',
    provenance: { path: 'beta/duplicate_inline_ref.md' },
  };
  const markup = renderToStaticMarkup(
    <MessageContent
      content="Open `methods.md`; keep `duplicate_inline_ref.md` as code."
      references={[pickedFile, duplicateA, duplicateB]}
      onObjectFocus={() => undefined}
    />,
  );

  assert.equal((markup.match(/data-sciforge-reference=/g) ?? []).length, 1);
  assert.match(markup, /<code>duplicate_inline_ref\.md<\/code>/);
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

test('system upload messages expose selected image refs for inline filename focus', () => {
  const message: SciForgeMessage = {
    id: 'msg-system-upload-image',
    role: 'system',
    content: '已上传 1 个文件作为引用：WX20260605-091908@2x.png',
    createdAt: '2026-06-05T00:00:00.000Z',
    references: [{
      id: 'ref-system-upload-image',
      kind: 'file',
      title: 'WX20260605-091908@2x.png',
      ref: '.sciforge/uploads/session-1/upload-image-WX20260605-091908@2x.png',
      summary: '用户上传文件 · uploaded-image',
      sourceId: 'upload-image-system',
      payload: {
        artifactId: 'upload-image-system',
        type: 'uploaded-image',
      },
    }],
  };
  const references = inlineObjectReferencesForMessage(message, sessionWithObjects());
  const markup = renderToStaticMarkup(
    <MessageContent
      content={message.content}
      references={references}
      onObjectFocus={() => undefined}
    />,
  );

  assert.equal(references.length, 1);
  assert.equal(references[0]?.kind, 'artifact');
  assert.equal(references[0]?.artifactType, 'image');
  assert.match(markup, /markdown-object-ref message-object-link/);
  assert.doesNotMatch(markup, /mailto:WX20260605-091908@2x\.png/);
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

test('scenario message resolves mentioned run artifact filenames into right-pane object refs', () => {
  const message: SciForgeMessage = {
    id: 'msg-ahe-summary',
    role: 'scenario',
    content: '完整中文总结见 AHE_Paper_Summary_CN.md。',
    createdAt: '2026-05-21T00:00:01.000Z',
    status: 'completed',
  };
  const session = sessionWithObjects({
    runs: [{
      id: 'run-ahe-summary',
      prompt: 'summarize paper',
      response: message.content,
      status: 'completed',
      scenarioId: 'literature-evidence-review',
      createdAt: '2026-05-21T00:00:00.000Z',
    }],
    artifacts: [{
      id: 'artifact-ahe-summary',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: 'test.runtime-artifact.v1',
      data: {},
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:artifact-ahe-summary',
        readableRef: 'reports/AHE_Paper_Summary_CN.md',
        previewPolicy: 'inline',
        role: 'primary-deliverable',
        contentShape: 'raw-file',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
      },
      metadata: {
        runId: 'run-ahe-summary',
        markdownRef: 'reports/AHE_Paper_Summary_CN.md',
      },
    }],
  });

  const references = inlineObjectReferencesForMessage(message, session, 'run-ahe-summary');
  const markup = renderToStaticMarkup(
    <MessageContent content={message.content} references={references} onObjectFocus={() => undefined} />,
  );

  assert.equal(references.length, 1);
  assert.equal(references[0]?.kind, 'artifact');
  assert.equal(references[0]?.ref, 'artifact:artifact-ahe-summary');
  assert.equal((markup.match(/data-sciforge-reference=/g) ?? []).length, 1);
  assert.match(markup, /markdown-object-ref/);
  assert.doesNotMatch(markup, /inline-object-reference-chip/);
});

test('scenario message leaves ambiguous mentioned artifact filenames as plain text', () => {
  const message: SciForgeMessage = {
    id: 'msg-ambiguous-summary',
    role: 'scenario',
    content: '完整中文总结见 AHE_Paper_Summary_CN.md。',
    createdAt: '2026-05-21T00:00:01.000Z',
    status: 'completed',
  };
  const session = sessionWithObjects({
    artifacts: [{
      id: 'artifact-ahe-alpha',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: 'test.runtime-artifact.v1',
      data: {},
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:artifact-ahe-alpha',
        readableRef: 'alpha/AHE_Paper_Summary_CN.md',
        previewPolicy: 'inline',
        role: 'primary-deliverable',
        contentShape: 'raw-file',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
      },
      metadata: { markdownRef: 'alpha/AHE_Paper_Summary_CN.md' },
    }, {
      id: 'artifact-ahe-beta',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: 'test.runtime-artifact.v1',
      data: {},
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:artifact-ahe-beta',
        readableRef: 'beta/AHE_Paper_Summary_CN.md',
        previewPolicy: 'inline',
        role: 'primary-deliverable',
        contentShape: 'raw-file',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
      },
      metadata: { markdownRef: 'beta/AHE_Paper_Summary_CN.md' },
    }],
  });

  const references = inlineObjectReferencesForMessage(message, session);
  const markup = renderToStaticMarkup(
    <MessageContent content={message.content} references={references} onObjectFocus={() => undefined} />,
  );

  assert.equal(references.length, 0);
  assert.doesNotMatch(markup, /data-sciforge-reference=/);
  assert.match(markup, /AHE_Paper_Summary_CN\.md/);
});

test('scenario message can focus a verified workspace-relative file mention', () => {
  const message: SciForgeMessage = {
    id: 'msg-workspace-file-summary',
    role: 'scenario',
    content: '完整中文总结见 `AHE_Paper_Summary_CN.md`。',
    createdAt: '2026-05-21T00:00:01.000Z',
    status: 'completed',
  };

  const references = inlineObjectReferencesForMessage(message, sessionWithObjects(), 'run-workspace-file', {
    workspaceObjectReferences: [workspaceFileReference('AHE_Paper_Summary_CN.md')],
  });
  const markup = renderToStaticMarkup(
    <MessageContent content={message.content} references={references} onObjectFocus={() => undefined} />,
  );

  assert.equal(references.length, 1);
  assert.equal(references[0]?.kind, 'file');
  assert.equal(references[0]?.ref, 'file:AHE_Paper_Summary_CN.md');
  assert.match(markup, /markdown-object-ref/);
});

test('scenario message leaves unverified workspace-relative file mentions as code', () => {
  const message: SciForgeMessage = {
    id: 'msg-workspace-file-missing',
    role: 'scenario',
    content: '完整中文总结见 `AHE_Paper_Summary_CN.md`。',
    createdAt: '2026-05-21T00:00:01.000Z',
    status: 'completed',
  };

  const references = inlineObjectReferencesForMessage(message, sessionWithObjects(), 'run-workspace-file');
  const markup = renderToStaticMarkup(
    <MessageContent content={message.content} references={references} onObjectFocus={() => undefined} />,
  );

  assert.equal(references.length, 0);
  assert.doesNotMatch(markup, /data-sciforge-reference=/);
  assert.match(markup, /<code>AHE_Paper_Summary_CN\.md<\/code>/);
});

test('scenario message resolves verified workspace references across data modalities', () => {
  const message: SciForgeMessage = {
    id: 'msg-workspace-multimodal',
    role: 'scenario',
    content: [
      '数据表见 inline_ref_table_20260521.csv。',
      '图像见 `figures/agent_trace.png`，PDF 见 `papers/agent_harness.pdf`。',
      'HTML 附录见 report.html，JSON 摘要见 `data/summary.json`。',
    ].join(' '),
    createdAt: '2026-05-21T00:00:01.000Z',
    status: 'completed',
  };

  const references = inlineObjectReferencesForMessage(message, sessionWithObjects(), 'run-workspace-multimodal', {
    workspaceObjectReferences: [
      workspaceFileReference('tables/inline_ref_table_20260521.csv'),
      workspaceFileReference('figures/agent_trace.png'),
      workspaceFileReference('papers/agent_harness.pdf'),
      workspaceFileReference('report.html'),
      workspaceFileReference('data/summary.json'),
    ],
  });
  const markup = renderToStaticMarkup(
    <MessageContent content={message.content} references={references} onObjectFocus={() => undefined} />,
  );

  assert.deepEqual(
    references.map((reference) => [reference.ref, reference.artifactType]),
    [
      ['file:tables/inline_ref_table_20260521.csv', 'data-table'],
      ['file:figures/agent_trace.png', 'image'],
      ['file:papers/agent_harness.pdf', 'pdf-document'],
      ['file:report.html', 'html-document'],
      ['file:data/summary.json', 'workspace-file'],
    ],
  );
  assert.equal((markup.match(/data-sciforge-reference=/g) ?? []).length, 5);
  assert.doesNotMatch(markup, /inline-object-reference-chip/);
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

function workspaceFileReference(path: string): ObjectReference {
  return {
    id: `workspace-${path.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    kind: 'file',
    title: path.split('/').at(-1) ?? path,
    ref: `file:${path}`,
    status: 'available',
    presentationRole: 'supporting-evidence',
    actions: ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'],
    provenance: {
      path,
      producer: 'workspace',
      size: 128,
    },
  };
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
