import type {
  ObjectAction,
  ObjectReference,
  ObjectReferenceKind,
} from '@sciforge-ui/runtime-contract/references';
import {
  displayTitleForObjectReference,
  objectReferencePresentationRole,
} from './presentation-role';

export interface ObjectReferenceTextPiece {
  text: string;
  reference?: ObjectReference;
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

export function linkifyObjectReferences(content: string, references: ObjectReference[]): ObjectReferenceTextPiece[] {
  if (!content || !references.length) return [{ text: content }];
  const candidates = objectReferenceLinkCandidates(references);
  if (!candidates.length) return [{ text: content }];
  const pieces: ObjectReferenceTextPiece[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const match = nextObjectReferenceMatch(content, cursor, candidates);
    if (!match) {
      pieces.push({ text: content.slice(cursor) });
      break;
    }
    if (match.index > cursor) pieces.push({ text: content.slice(cursor, match.index) });
    pieces.push({ text: displayTitleForObjectReference(match.reference), reference: match.reference });
    cursor = match.index + match.key.length;
  }
  return pieces.filter((piece) => piece.text.length > 0);
}

function objectReferenceFromInlineToken(raw: string, runId?: string): ObjectReference | undefined {
  if (/^https?:\/\//i.test(raw)) {
    const reference: ObjectReference = {
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
    return {
      ...reference,
      presentationRole: objectReferencePresentationRole(reference),
    };
  }
  const tokenMatch = raw.match(/^([a-z-]+)::?(.+)$/i);
  if (!tokenMatch) return undefined;
  const prefix = tokenMatch[1].toLowerCase() as ObjectReferenceKind;
  if (!['artifact', 'file', 'folder', 'run', 'execution-unit', 'scenario-package'].includes(prefix)) return undefined;
  const target = tokenMatch[2];
  const reference: ObjectReference = {
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
  return {
    ...reference,
    presentationRole: objectReferencePresentationRole(reference),
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
