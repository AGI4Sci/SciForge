import { Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { ObjectReference } from '../../domain';
import {
  referenceForObjectReference,
  resolveInlineObjectReferenceToken,
  sciForgeReferenceAttribute,
} from '../../../../../packages/support/object-references';

const CJK_AUTOLINK_BOUNDARY_PATTERN = /[、，。；：！？）】》」』]/u;
const TRAILING_INLINE_REFERENCE_PUNCTUATION_PATTERN = /[.,;，。；、：！？）】》」』]+$/u;

export function MarkdownRenderer({
  markdown,
  className = 'markdown-block',
  objectReferences = [],
  onObjectReferenceFocus,
}: {
  markdown?: string;
  className?: string;
  objectReferences?: ObjectReference[];
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  const components: Components = {
    a({ href, children }) {
      const inlineReference = inlineReferenceForLinkLabel(children, objectReferences);
      if (inlineReference && onObjectReferenceFocus) {
        return (
          <button
            type="button"
            className="markdown-object-ref message-object-link"
            onClick={() => onObjectReferenceFocus(inlineReference)}
            data-sciforge-reference={sciForgeReferenceAttribute(referenceWithObjectPayload(inlineReference))}
          >
            {children}
          </button>
        );
      }
      const autolinkBoundary = splitAutolinkLiteralBoundary(children);
      if (autolinkBoundary) {
        const safeHref = safeMarkdownHref(autolinkBoundary.href);
        if (!safeHref) return <span className="markdown-disabled-link">{children}</span>;
        return (
          <>
            <a href={safeHref} target="_blank" rel="noreferrer">{autolinkBoundary.label}</a>
            {autolinkBoundary.suffix}
          </>
        );
      }
      const safeHref = safeMarkdownHref(href);
      if (!safeHref) return <span className="markdown-disabled-link">{children}</span>;
      return <a href={safeHref} target="_blank" rel="noreferrer">{children}</a>;
    },
    p({ children }) {
      return <p>{linkExplicitReferenceText(children, objectReferences, onObjectReferenceFocus)}</p>;
    },
    li({ children }) {
      return <li>{linkExplicitReferenceText(children, objectReferences, onObjectReferenceFocus)}</li>;
    },
    td({ children }) {
      return <td>{linkExplicitReferenceText(children, objectReferences, onObjectReferenceFocus)}</td>;
    },
    th({ children }) {
      return <th>{linkExplicitReferenceText(children, objectReferences, onObjectReferenceFocus)}</th>;
    },
    blockquote({ children }) {
      return <blockquote>{linkExplicitReferenceText(children, objectReferences, onObjectReferenceFocus)}</blockquote>;
    },
    code({ children, className }) {
      const token = textFromReactNode(children);
      const reference = !className && token ? resolveInlineObjectReferenceToken(token, objectReferences) : undefined;
      if (!reference || !onObjectReferenceFocus) return <code className={className}>{children}</code>;
      return (
        <button
          type="button"
          className="markdown-object-ref message-object-link"
          onClick={() => onObjectReferenceFocus(reference)}
          data-sciforge-reference={sciForgeReferenceAttribute(referenceWithObjectPayload(reference))}
        >
          <code>{children}</code>
        </button>
      );
    },
    table({ children }) {
      return (
        <div className="markdown-table-scroll">
          <table>{children}</table>
        </div>
      );
    },
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, trust: false }]]}
        components={components}
        skipHtml
        urlTransform={(url) => safeMarkdownHref(url) ?? ''}
      >
        {markdown ?? ''}
      </ReactMarkdown>
    </div>
  );
}

function inlineReferenceForLinkLabel(children: ReactNode, objectReferences: ObjectReference[]) {
  const label = textFromReactNode(children).trim();
  return label ? resolveInlineObjectReferenceToken(label, objectReferences) : undefined;
}

function safeMarkdownHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('#')) return trimmed;
  if (/^mailto:[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function splitAutolinkLiteralBoundary(children: ReactNode): { href: string; label: string; suffix: string } | undefined {
  const label = textFromReactNode(children);
  const protocol = /^https?:\/\//i.exec(label)?.[0];
  if (!protocol) return undefined;
  const boundaryIndex = label.search(CJK_AUTOLINK_BOUNDARY_PATTERN);
  if (boundaryIndex <= protocol.length) return undefined;
  const href = label.slice(0, boundaryIndex);
  const suffix = label.slice(boundaryIndex);
  return suffix ? { href, label: href, suffix } : undefined;
}

function textFromReactNode(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textFromReactNode).join('');
  return '';
}

function linkExplicitReferenceText(
  value: ReactNode,
  references: ObjectReference[],
  onFocus: ((reference: ObjectReference) => void) | undefined,
): ReactNode {
  if (!onFocus || !references.length) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    return linkExplicitReferenceString(String(value), references, onFocus);
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => (
      <Fragment key={index}>{linkExplicitReferenceText(child, references, onFocus)}</Fragment>
    ));
  }
  if (!isValidElement(value)) return value;
  const element = value as ReactElement<{ children?: ReactNode; className?: string }>;
  if (typeof element.type === 'string' && ['a', 'button', 'code', 'pre'].includes(element.type)) return value;
  const children = element.props.children;
  if (children === undefined) return value;
  return cloneElement(element, {
    children: linkExplicitReferenceText(children, references, onFocus),
  });
}

function linkExplicitReferenceString(
  value: string,
  references: ObjectReference[],
  onFocus: (reference: ObjectReference) => void,
): ReactNode {
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(inlineReferenceTextPattern())) {
    const token = match[0].replace(TRAILING_INLINE_REFERENCE_PUNCTUATION_PATTERN, '');
    const index = match.index ?? 0;
    if (index < cursor) continue;
    const reference = resolveInlineObjectReferenceToken(token, references);
    if (!reference) continue;
    if (index > cursor) pieces.push(value.slice(cursor, index));
    pieces.push(
      <button
        key={`${reference.id}-${index}`}
        type="button"
        className="markdown-object-ref message-object-link"
        onClick={() => onFocus(reference)}
        data-sciforge-reference={sciForgeReferenceAttribute(referenceWithObjectPayload(reference))}
      >
        {token}
      </button>,
    );
    cursor = index + token.length;
  }
  if (cursor === 0) return value;
  if (cursor < value.length) pieces.push(value.slice(cursor));
  return pieces;
}

function inlineReferenceTextPattern() {
  return /\b(?:(?:artifact|file|folder|run|execution-unit|scenario-package)::?[^\s)\]）>，。；、：！？】》」』,;]+|https?:\/\/[^\s)\]）>，。；、：！？】》」』]+|(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:md|markdown|txt|log|jsonl?|csv|tsv|html?|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|pdb|cif|mmcif))(?![A-Za-z0-9_./-])/gi;
}

function referenceWithObjectPayload(reference: ObjectReference) {
  const base = referenceForObjectReference(reference);
  const payload = isRecord(base.payload) ? base.payload : {};
  return {
    ...base,
    title: reference.title || base.title,
    ref: reference.ref || base.ref,
    sourceId: reference.id || base.sourceId,
    runId: reference.runId ?? base.runId,
    payload: {
      ...payload,
      currentReference: reference,
      objectReference: reference,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
