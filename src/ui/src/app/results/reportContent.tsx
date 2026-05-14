import { type ReactNode } from 'react';
import type { ObjectReference } from '../../domain';
import {
  coerceArtifactReportPayload,
  hasInlineObjectReferenceText,
  inlineObjectReferenceFromMarkdownRef,
  splitInlineObjectReferenceText,
} from '@sciforge-ui/artifact-preview';

export { coerceArtifactReportPayload as coerceReportPayload } from '@sciforge-ui/artifact-preview';

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
