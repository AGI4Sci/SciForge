import type { ReactNode } from 'react';
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
    code({ children, className }) {
      const token = textFromReactNode(children);
      const reference = !className && token ? resolveInlineObjectReferenceToken(token, objectReferences) : undefined;
      if (!reference || !onObjectReferenceFocus) return <code className={className}>{children}</code>;
      return (
        <button
          type="button"
          className="markdown-object-ref message-object-link"
          onClick={() => onObjectReferenceFocus(reference)}
          data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference))}
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
