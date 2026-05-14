import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownRenderer({
  markdown,
  className = 'markdown-block',
}: {
  markdown?: string;
  className?: string;
}) {
  const components: Components = {
    a({ href, children }) {
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
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
