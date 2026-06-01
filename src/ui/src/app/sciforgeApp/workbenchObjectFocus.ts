import type { ObjectReference, SciForgeSession } from '../../domain';
import { createSelectObjectUIAction, type SelectObjectUIAction } from '../uiActionBoundary';

const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:\\[^\s"'`<>;?#)]*|\/(?:Applications|Users|Volumes|private|tmp|var)\/[^\s"'`<>;?#)]*)/g;
const SECRET_QUERY_PATTERN = /((?:api[_-]?key|token|secret|password|credential)=)[^&\s"'`<>)]*/gi;
const AUTH_HEADER_PATTERN = /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"'`<>)]*/gi;

export function createWorkbenchObjectFocusUIAction(input: {
  session: SciForgeSession;
  reference: ObjectReference;
  id: string;
  createdAt: string;
}): SelectObjectUIAction {
  return createSelectObjectUIAction({
    session: input.session,
    id: input.id,
    createdAt: input.createdAt,
    objectRef: publicObjectFocusAuditRef(input.reference),
    intent: 'inspect',
  });
}

export function publicObjectFocusAuditRef(reference: ObjectReference) {
  const fallback = `object:${reference.kind}:${reference.id}`;
  const raw = reference.ref.trim() || fallback;
  const redacted = raw
    .replace(LOCAL_PATH_PATTERN, '[local-path]')
    .replace(SECRET_QUERY_PATTERN, '$1[redacted]')
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .trim();
  return compactAuditRef(redacted || fallback);
}

function compactAuditRef(value: string) {
  if (value.length <= 240) return value;
  return `${value.slice(0, 237)}...`;
}
