import { useEffect, useState, type ReactNode } from 'react';
import type { SciForgeConfig, SciForgeSession, ObjectReference, RuntimeArtifact, UIManifestSlot } from '../../domain';
import { readWorkspaceFile } from '../../api/workspaceClient';
import { elementRegistry } from '@sciforge/scenario-core/element-registry';
import { scenarioReportViewerEmptyStatePolicy } from '@sciforge/scenario-core/scenario-builder-display-policy';
import { EmptyArtifactState } from '../uiPrimitives';
import {
  coerceArtifactReportPayload,
  hasInlineObjectReferenceText,
  inlineObjectReferenceFromMarkdownRef,
  relatedArtifactsForReportPolicy,
  reportRecordToReadableText,
  reportSectionsToMarkdown,
  splitInlineObjectReferenceText,
} from '@sciforge-ui/artifact-preview';

export { coerceArtifactReportPayload as coerceReportPayload } from '@sciforge-ui/artifact-preview';

export type ReportViewerSlotProps = {
  scenarioId: unknown;
  config: SciForgeConfig;
  session: SciForgeSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function slotPayload(slot: UIManifestSlot, artifact?: RuntimeArtifact): Record<string, unknown> {
  const props = slot.props ?? {};
  if (!artifact) return props;
  const artifactRecord = artifact as RuntimeArtifact & Record<string, unknown>;
  const artifactData = isRecord(artifact.data) ? artifact.data : {};
  const nestedContent = isRecord(artifactRecord.content)
    ? artifactRecord.content
    : isRecord(artifactData.content)
      ? artifactData.content
      : {};
  return {
    ...props,
    ...artifactRecord,
    ...artifactData,
    ...nestedContent,
  };
}

function ComponentEmptyState({
  componentId,
  artifactType,
  title,
  detail,
}: {
  componentId: string;
  artifactType?: string;
  title?: string;
  detail?: string;
}) {
  const component = elementRegistry.components.find((item) => item.componentId === componentId);
  const producerSkillIds = artifactType
    ? elementRegistry.artifacts.find((item) => item.artifactType === artifactType)?.producerSkillIds ?? []
    : [];
  const recoverActions = [
    ...(component?.recoverActions ?? []),
    ...producerSkillIds.slice(0, 2).map((skillId) => `run-skill:${skillId}`),
  ];
  return (
    <EmptyArtifactState
      title={title ?? component?.emptyState.title ?? '等待 runtime artifact'}
      detail={detail ?? component?.emptyState.detail ?? '当前组件没有可展示 artifact；请运行场景或导入匹配数据。'}
      recoverActions={Array.from(new Set(recoverActions))}
    />
  );
}

export function ReportViewerSlot({ slot, artifact, config, session, onObjectReferenceFocus }: ReportViewerSlotProps) {
  const payload = slotPayload(slot, artifact);
  const report = coerceArtifactReportPayload(payload, artifact, relatedArtifactsForReportPolicy(session.artifacts, artifact));
  const [loadedReport, setLoadedReport] = useState<{ ref: string; markdown: string } | undefined>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const ref = report.reportRef;
    if (!ref || loadedReport?.ref === ref) return undefined;
    let cancelled = false;
    setLoadError('');
    void readWorkspaceFile(ref, config)
      .then((file) => {
        if (!cancelled) setLoadedReport({ ref, markdown: file.content });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [config, loadedReport?.ref, report.reportRef]);
  const loadedMarkdown = loadedReport && loadedReport.ref === report.reportRef ? loadedReport.markdown : undefined;
  const markdown = loadedMarkdown ?? report.markdown;
  const sections = loadedMarkdown || (report.reportRef && !loadError) ? [] : report.sections;
  if (!artifact || (!markdown && !sections.length)) {
    return <ComponentEmptyState {...scenarioReportViewerEmptyStatePolicy({ hasArtifact: Boolean(artifact) })} />;
  }
  return (
    <div className="stack">
      <div className="report-viewer">
        <div className="report-actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(markdown || reportSectionsToMarkdown(sections))}>
            复制 Markdown
          </button>
        </div>
        {report.reportRef && !loadedReport && !loadError ? (
          <p className="empty-state">正在读取 Markdown 报告正文：{report.reportRef}</p>
        ) : null}
        {loadError ? (
          <details className="report-read-warning">
            <summary>外部报告正文暂不可读，已展示可用 artifacts 生成的摘要</summary>
            <p>{loadError}</p>
          </details>
        ) : null}
        {sections.length ? sections.map((section, index) => (
          <section key={`${asString(section.title) ?? 'section'}-${index}`}>
            <h3>{asString(section.title) || `Section ${index + 1}`}</h3>
            <MarkdownBlock markdown={asString(section.content) || asString(section.markdown) || reportRecordToReadableText(section)} onObjectReferenceFocus={onObjectReferenceFocus} />
          </section>
        )) : <MarkdownBlock markdown={markdown} onObjectReferenceFocus={onObjectReferenceFocus} />}
      </div>
    </div>
  );
}

export function MarkdownBlock({ markdown, onObjectReferenceFocus }: { markdown?: string; onObjectReferenceFocus?: (reference: ObjectReference) => void }) {
  const lines = (markdown || '').split('\n');
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  function flushList() {
    if (!list.length) return;
    nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{inlineMarkdown(item, onObjectReferenceFocus)}</li>)}</ul>);
    list = [];
  }
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      flushList();
      const level = trimmed.match(/^#+/)?.[0].length ?? 2;
      const text = trimmed.replace(/^#{1,4}\s+/, '');
      nodes.push(level <= 2 ? <h3 key={index}>{inlineMarkdown(text, onObjectReferenceFocus)}</h3> : <h4 key={index}>{inlineMarkdown(text, onObjectReferenceFocus)}</h4>);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-*]\s+/, ''));
      return;
    }
    flushList();
    nodes.push(<p key={index}>{inlineMarkdown(trimmed, onObjectReferenceFocus)}</p>);
  });
  flushList();
  return <div className="markdown-block">{nodes}</div>;
}

function inlineMarkdown(text: string, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{inlinePlainText(part.slice(2, -2), onObjectReferenceFocus)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) {
      const codeText = part.slice(1, -1);
      const reference = inlineObjectReferenceFromMarkdownRef(codeText);
      return reference ? inlineObjectReferenceButton(reference, index, onObjectReferenceFocus) : <code key={index}>{codeText}</code>;
    }
    return <span key={index}>{inlinePlainText(part, onObjectReferenceFocus)}</span>;
  });
}

function inlinePlainText(text: string, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  return splitInlineObjectReferenceText(text).map((part, index) => {
    const reference = part.reference;
    if (!reference) return <span key={index}>{part.text}</span>;
    return inlineObjectReferenceButton(reference, index, onObjectReferenceFocus);
  });
}

function inlineObjectReferenceButton(reference: ObjectReference, key: string | number, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  return (
    <button
      key={key}
      type="button"
      className="markdown-object-ref"
      title={reference.ref}
      onClick={() => focusInlineObjectReference(reference, onObjectReferenceFocus)}
    >
      {reference.title}
    </button>
  );
}

export function hydrateInlineObjectReferenceButtons(root: ParentNode = document): () => void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent || '';
      if (!hasInlineObjectReferenceText(text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest('button,a,textarea,input,script,style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent || '';
    const parts = splitInlineObjectReferenceText(text);
    if (parts.length < 2) continue;
    const fragment = document.createDocumentFragment();
    let changed = false;
    for (const part of parts) {
      const reference = part.reference;
      if (!reference) {
        fragment.append(document.createTextNode(part.text));
        continue;
      }
      changed = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'markdown-object-ref';
      button.title = reference.ref;
      button.textContent = reference.title;
      button.addEventListener('click', () => focusInlineObjectReference(reference));
      fragment.append(button);
    }
    if (!changed || !node.parentNode) continue;
    node.parentNode.replaceChild(fragment, node);
  }
  return () => undefined;
}

function focusInlineObjectReference(reference: ObjectReference, onObjectReferenceFocus?: (reference: ObjectReference) => void) {
  if (onObjectReferenceFocus) {
    onObjectReferenceFocus(reference);
    return;
  }
  window.dispatchEvent(new CustomEvent('sciforge-focus-object-reference', { detail: reference }));
}
