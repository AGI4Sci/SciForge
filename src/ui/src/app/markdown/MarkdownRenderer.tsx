import { Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ObjectReference } from '../../domain';
import {
  referenceForObjectReference,
  resolveInlineObjectReferenceToken,
  sciForgeReferenceAttribute,
} from '../../../../../packages/support/object-references';

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
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
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
        remarkPlugins={[remarkGfm]}
        components={components}
        skipHtml
        urlTransform={(url) => url}
      >
        {markdown ?? ''}
      </ReactMarkdown>
    </div>
  );
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
  for (const match of value.matchAll(/\b(?:(?:artifact|file|folder|run|execution-unit|scenario-package)::?[^\s)\]）>，。；、,;]+|https?:\/\/[^\s)\]）>，。；、]+)[^\s)\]）>，。；、,;]*/gi)) {
    const token = match[0].replace(/[.,;，。；、]+$/, '');
    const index = match.index ?? 0;
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
