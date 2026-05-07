import type { ReactNode } from 'react';
import type { ObjectAction, ObjectReference, ObjectReferenceKind, SciForgeMessage, SciForgeSession } from '../../domain';
import {
  mergeObjectReferences,
  objectReferenceForArtifactSummary,
  referenceForObjectReference,
  sciForgeReferenceAttribute,
} from '../../../../../packages/object-references';

export function MessageContent({
  content,
  references,
  onObjectFocus,
}: {
  content: string;
  references: ObjectReference[];
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  return (
    <div className="message-content">
      {renderMarkdownBlocks(content, references, onObjectFocus)}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; depth: number; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language?: string; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'rule' };

function renderMarkdownBlocks(
  markdown: string,
  references: ObjectReference[],
  onObjectFocus: (reference: ObjectReference) => void,
): ReactNode[] {
  const blocks = parseMarkdownBlocks(markdown);
  return blocks.map((block, index) => {
    const key = `md-${index}`;
    if (block.type === 'heading') {
      const children = renderInlineMarkdown(block.text, references, onObjectFocus, key);
      if (block.depth === 1) return <h1 key={key}>{children}</h1>;
      if (block.depth === 2) return <h2 key={key}>{children}</h2>;
      if (block.depth === 3) return <h3 key={key}>{children}</h3>;
      if (block.depth === 4) return <h4 key={key}>{children}</h4>;
      if (block.depth === 5) return <h5 key={key}>{children}</h5>;
      return <h6 key={key}>{children}</h6>;
    }
    if (block.type === 'blockquote') {
      return <blockquote key={key}>{renderInlineMarkdown(block.text, references, onObjectFocus, key)}</blockquote>;
    }
    if (block.type === 'code') {
      return (
        <pre key={key} className="message-code-block">
          {block.language ? <span className="message-code-lang">{block.language}</span> : null}
          <code>{block.text}</code>
        </pre>
      );
    }
    if (block.type === 'list') {
      const items = block.items.map((item, itemIndex) => (
        <li key={`${key}-li-${itemIndex}`}>{renderInlineMarkdown(item, references, onObjectFocus, `${key}-${itemIndex}`)}</li>
      ));
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    if (block.type === 'table') {
      const [head, ...body] = block.rows;
      return (
        <div key={key} className="message-table-scroll">
          <table>
            {head ? (
              <thead>
                <tr>{head.map((cell, cellIndex) => <th key={`${key}-th-${cellIndex}`}>{renderInlineMarkdown(cell, references, onObjectFocus, `${key}-h-${cellIndex}`)}</th>)}</tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`${key}-tr-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`${key}-td-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell, references, onObjectFocus, `${key}-c-${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.type === 'rule') return <hr key={key} />;
    return <p key={key}>{renderInlineMarkdown(block.text, references, onObjectFocus, key)}</p>;
  });
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence[1], text: code.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', depth: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }
    if (isMarkdownTableAt(lines, index)) {
      const rows: string[][] = [];
      rows.push(splitMarkdownTableRow(lines[index]));
      index += 2;
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const match = orderedList ? lines[index].match(/^\s*\d+[.)]\s+(.+)$/) : lines[index].match(/^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ type: 'list', ordered: orderedList, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: quote.join('\n') });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks.length ? blocks : [{ type: 'paragraph', text: '' }];
}

function isMarkdownBlockStart(lines: string[], index: number) {
  const line = lines[index];
  return /^```/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || isMarkdownTableAt(lines, index);
}

function isMarkdownTableAt(lines: string[], index: number) {
  return index + 1 < lines.length
    && /^\s*\|.+\|\s*$/.test(lines[index])
    && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function splitMarkdownTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderInlineMarkdown(
  text: string,
  references: ObjectReference[],
  onObjectFocus: (reference: ObjectReference) => void,
  keyPrefix: string,
): ReactNode[] {
  const pieces = linkifyObjectReferences(text, references);
  const nodes: ReactNode[] = [];
  pieces.forEach((piece, index) => {
    if (piece.reference) {
      nodes.push(
        <button
          key={`${keyPrefix}-ref-${index}`}
          type="button"
          className="message-object-link"
          onClick={() => onObjectFocus(piece.reference as ObjectReference)}
          title={piece.reference.summary || piece.reference.ref}
          data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(piece.reference))}
        >
          {piece.text}
        </button>,
      );
    } else {
      nodes.push(...renderInlineText(piece.text, `${keyPrefix}-txt-${index}`));
    }
  });
  return nodes;
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+(?:\*[^*\n]+)*\*\*|\[[^\]\n]+\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    appendPlainInlineText(nodes, text.slice(lastIndex, match.index), `${keyPrefix}-plain-${nodes.length}`);
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-code-${nodes.length}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-strong-${nodes.length}`}>{renderInlineText(token.slice(2, -2), `${keyPrefix}-strong-${nodes.length}`)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={`${keyPrefix}-em-${nodes.length}`}>{renderInlineText(token.slice(1, -1), `${keyPrefix}-em-${nodes.length}`)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a key={`${keyPrefix}-link-${nodes.length}`} href={link[2]} target="_blank" rel="noreferrer">
            {renderInlineText(link[1], `${keyPrefix}-link-${nodes.length}`)}
          </a>,
        );
      } else {
        appendPlainInlineText(nodes, token, `${keyPrefix}-fallback-${nodes.length}`);
      }
    }
    lastIndex = match.index + token.length;
  }
  appendPlainInlineText(nodes, text.slice(lastIndex), `${keyPrefix}-tail-${nodes.length}`);
  return nodes;
}

function appendPlainInlineText(nodes: ReactNode[], text: string, keyPrefix: string) {
  if (!text) return;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line) nodes.push(<span key={`${keyPrefix}-${index}`}>{line}</span>);
    if (index < lines.length - 1) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
  });
}

export function inlineObjectReferencesForMessage(message: SciForgeMessage, session: SciForgeSession, runId?: string) {
  const run = runId ? session.runs.find((item) => item.id === runId) : undefined;
  const runArtifactRefs = new Set((run?.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref.replace(/^artifact:/, '')));
  const runArtifacts = session.artifacts
    .filter((artifact) => runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId)
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  const structuredReferences = mergeObjectReferences(message.objectReferences ?? [], mergeObjectReferences(run?.objectReferences ?? [], runArtifacts), 32);
  return mergeObjectReferences(objectReferencesFromInlineTokens(message.content, runId), structuredReferences, 40);
}

export function objectReferencesFromInlineTokens(content: string, runId?: string) {
  const references: ObjectReference[] = [];
  const seen = new Set<string>();
  const tokenPattern = /\b(?:(?:artifact|file|folder|run|execution-unit|scenario-package)::?[^\s)\]）>，。；、,;]+|https?:\/\/[^\s)\]）>，。；、]+)[^\s)\]）>，。；、,;]*/gi;
  for (const match of content.matchAll(tokenPattern)) {
    const raw = match[0].replace(/[.,;，。；、]+$/, '');
    const reference = objectReferenceFromInlineToken(raw, runId);
    if (!reference || seen.has(reference.ref)) continue;
    seen.add(reference.ref);
    references.push(reference);
  }
  return references;
}

function objectReferenceFromInlineToken(raw: string, runId?: string): ObjectReference | undefined {
  if (/^https?:\/\//i.test(raw)) {
    return {
      id: inlineObjectReferenceId('url', raw),
      title: inlineReferenceTitle(raw),
      kind: 'url',
      ref: `url:${raw}`,
      runId,
      actions: ['focus-right-pane', 'open-external', 'copy-path'],
      status: 'external',
      summary: raw,
      provenance: { dataRef: raw },
    };
  }
  const tokenMatch = raw.match(/^([a-z-]+)::?(.+)$/i);
  if (!tokenMatch) return undefined;
  const prefix = tokenMatch[1].toLowerCase() as ObjectReferenceKind;
  if (!['artifact', 'file', 'folder', 'run', 'execution-unit', 'scenario-package'].includes(prefix)) return undefined;
  const target = tokenMatch[2];
  return {
    id: inlineObjectReferenceId(prefix, raw),
    title: inlineReferenceTitle(target),
    kind: prefix,
    ref: raw,
    runId,
    actions: inlineObjectReferenceActions(prefix),
    status: 'available',
    summary: target,
    provenance: prefix === 'file' || prefix === 'folder' ? { path: target } : { dataRef: target },
  };
}

function inlineObjectReferenceActions(kind: ObjectReferenceKind): ObjectAction[] {
  if (kind === 'file' || kind === 'folder') return ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'];
  if (kind === 'url') return ['focus-right-pane', 'open-external', 'copy-path'];
  return ['focus-right-pane', 'inspect', 'copy-path', 'pin'];
}

function inlineObjectReferenceId(kind: ObjectReferenceKind, ref: string) {
  return `inline-${kind}-${ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
}

function inlineReferenceTitle(ref: string) {
  try {
    const value = decodeURIComponent(ref.replace(/^url:/i, ''));
    const trimmed = value.replace(/[?#].*$/, '').replace(/\/$/, '');
    return trimmed.split('/').pop() || value;
  } catch {
    return ref;
  }
}

export function unmentionedObjectReferencesForMessage(message: SciForgeMessage, session: SciForgeSession, runId?: string) {
  const mentioned = new Set(linkifyObjectReferences(message.content, inlineObjectReferencesForMessage(message, session, runId))
    .flatMap((piece) => piece.reference ? [piece.reference.ref] : []));
  return inlineObjectReferencesForMessage(message, session, runId).filter((reference) => !mentioned.has(reference.ref));
}

function linkifyObjectReferences(content: string, references: ObjectReference[]) {
  if (!content || !references.length) return [{ text: content }];
  const candidates = objectReferenceLinkCandidates(references);
  if (!candidates.length) return [{ text: content }];
  const pieces: Array<{ text: string; reference?: ObjectReference }> = [];
  let cursor = 0;
  while (cursor < content.length) {
    const match = nextObjectReferenceMatch(content, cursor, candidates);
    if (!match) {
      pieces.push({ text: content.slice(cursor) });
      break;
    }
    if (match.index > cursor) pieces.push({ text: content.slice(cursor, match.index) });
    pieces.push({ text: content.slice(match.index, match.index + match.key.length), reference: match.reference });
    cursor = match.index + match.key.length;
  }
  return pieces.filter((piece) => piece.text.length > 0);
}

function nextObjectReferenceMatch(
  content: string,
  cursor: number,
  candidates: Array<{ key: string; reference: ObjectReference }>,
) {
  let best: { index: number; key: string; reference: ObjectReference } | undefined;
  for (const candidate of candidates) {
    const index = content.indexOf(candidate.key, cursor);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && candidate.key.length > best.key.length)) {
      best = { index, key: candidate.key, reference: candidate.reference };
    }
  }
  return best;
}

function objectReferenceLinkCandidates(references: ObjectReference[]) {
  const candidates: Array<{ key: string; reference: ObjectReference }> = [];
  const seen = new Set<string>();
  for (const reference of references) {
    for (const key of objectReferenceLinkKeys(reference)) {
      const trimmed = key.trim();
      if (trimmed.length < 4 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      candidates.push({ key: trimmed, reference });
    }
  }
  return candidates.sort((left, right) => right.key.length - left.key.length);
}

function objectReferenceLinkKeys(reference: ObjectReference) {
  const keys = [
    reference.ref,
    reference.ref.replace(/^file:/i, 'file::'),
    reference.ref.replace(/^folder:/i, 'folder::'),
    reference.ref.replace(/^artifact:/i, ''),
    reference.title,
    reference.provenance?.path,
    reference.provenance?.dataRef,
    reference.provenance?.path ? `file:${reference.provenance.path}` : undefined,
    reference.provenance?.path ? `file::${reference.provenance.path}` : undefined,
    reference.provenance?.dataRef ? `file:${reference.provenance.dataRef}` : undefined,
    reference.provenance?.dataRef ? `file::${reference.provenance.dataRef}` : undefined,
  ];
  return keys.filter((key): key is string => Boolean(key && key.trim()));
}
