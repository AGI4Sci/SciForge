import type { ObjectReference } from '../../domain';
import { sanitizeUserProjectionText } from '../conversation-projection-view-model';
import { objectReferenceForCursorRef } from './cursorProcessObjectReferences';
import { runtimeGuiChoicesFromEventPayload, type RuntimeGuiChoice } from './runtimeGuiCommands';

export interface RuntimeGuiSurface {
  guiPresentation?: unknown;
  guiAskUser?: unknown;
}

interface NormalizedGuiPresentation {
  title?: string;
  text?: string;
  ref?: string;
  status?: string;
  displayedRefs: string[];
}

interface NormalizedGuiAskUser {
  title: string;
  message?: string;
  kind?: string;
  risk?: string;
  publicProjection?: NormalizedGuiPublicProjection;
  relatedRefs: string[];
  choices: RuntimeGuiChoice[];
}

interface NormalizedGuiPublicProjection {
  action?: string;
  target?: string;
  impact?: string;
  evidenceRefs: string[];
  authorizationProfile?: string;
}

export function hasRuntimeGuiSurface(surface: RuntimeGuiSurface | undefined) {
  return Boolean(normalizeGuiPresentation(surface?.guiPresentation) || normalizeGuiAskUser(surface?.guiAskUser));
}

export function RuntimeGuiPanel({
  surface,
  onCommand,
  onObjectFocus,
}: {
  surface?: RuntimeGuiSurface;
  onCommand?: (commandText: string) => void;
  onObjectFocus?: (reference: ObjectReference) => void;
}) {
  const presentation = normalizeGuiPresentation(surface?.guiPresentation);
  const askUser = normalizeGuiAskUser(surface?.guiAskUser);
  if (!presentation && !askUser) return null;
  return (
    <div className="runtime-gui-panel" data-testid="runtime-gui-panel">
      {presentation ? (
        <section
          className="runtime-gui-card runtime-gui-present"
          data-testid="runtime-gui-present"
          data-gui-surface="presentation"
          aria-label="Presented result"
        >
          <div className="runtime-gui-card-head">
            <span>Operation result</span>
            <strong>{humanGuiTitle(presentation.title) ?? 'Result ready'}</strong>
            {presentation.status ? <small>{humanStatusLabel(presentation.status)}</small> : null}
          </div>
          {presentation.text ? <p>{humanGuiMessage(presentation.text)}</p> : null}
          <RuntimeGuiRefList refs={uniqueStrings([presentation.ref, ...presentation.displayedRefs])} onObjectFocus={onObjectFocus} />
        </section>
      ) : null}
      {askUser ? (
        <section
          className="runtime-gui-card runtime-gui-ask-user"
          data-testid="runtime-gui-ask-user"
          data-gui-surface="confirmation"
          aria-label="Confirmation request"
        >
          <div className="runtime-gui-card-head">
            <span>{askUser.kind === 'blocked' ? 'Blocked' : 'Needs confirmation'}</span>
            <strong>{humanGuiTitle(askUser.title) ?? 'Confirm before continuing'}</strong>
            {askUser.risk ? <small>{humanRiskLabel(askUser.risk)}</small> : null}
          </div>
          {askUser.message ? <p>{humanGuiMessage(askUser.message)}</p> : null}
          <RuntimeGuiPublicProjectionFields projection={askUser.publicProjection} onObjectFocus={onObjectFocus} />
          <RuntimeGuiRefList refs={runtimeGuiRelatedRefsOutsidePublicProjection(askUser)} onObjectFocus={onObjectFocus} />
          {askUser.choices.length ? (
            <div className="runtime-gui-choice-row">
              {askUser.choices.map((choice) => {
                const label = runtimeGuiChoiceDisplayLabel(choice.label);
                return (
                  <button
                    type="button"
                    key={`${choice.label}-${choice.commandText}`}
                    className={`runtime-gui-choice ${choice.style === 'danger' ? 'danger' : choice.style === 'primary' ? 'primary' : ''}`}
                    onClick={() => onCommand?.(choice.commandText)}
                    title={label}
                  >
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function RuntimeGuiPublicProjectionFields({
  projection,
  onObjectFocus,
}: {
  projection?: NormalizedGuiPublicProjection;
  onObjectFocus?: (reference: ObjectReference) => void;
}) {
  if (!projection) return null;
  const rows: Array<[string, string]> = [];
  if (projection.action) rows.push(['Action', projection.action]);
  if (projection.target) rows.push(['Target', projection.target]);
  if (projection.impact) rows.push(['Impact', projection.impact]);
  if (projection.authorizationProfile) rows.push(['Authorization profile', projection.authorizationProfile]);
  if (!rows.length && !projection.evidenceRefs.length) return null;
  return (
    <dl className="runtime-gui-public-projection" aria-label="Authorization request details">
      {rows.map(([label, value]) => (
        <div className="runtime-gui-public-projection-row" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      {projection.evidenceRefs.length ? (
        <div className="runtime-gui-public-projection-row">
          <dt>Evidence refs</dt>
          <dd><RuntimeGuiRefList refs={projection.evidenceRefs} onObjectFocus={onObjectFocus} /></dd>
        </div>
      ) : null}
    </dl>
  );
}

function runtimeGuiRelatedRefsOutsidePublicProjection(askUser: NormalizedGuiAskUser) {
  const publicRefs = new Set(askUser.publicProjection?.evidenceRefs ?? []);
  return publicRefs.size ? askUser.relatedRefs.filter((ref) => !publicRefs.has(ref)) : askUser.relatedRefs;
}

function RuntimeGuiRefList({ refs, onObjectFocus }: { refs: string[]; onObjectFocus?: (reference: ObjectReference) => void }) {
  const visibleRefs = uniqueStrings(refs)
    .map(runtimeGuiObjectReference)
    .filter((entry): entry is RuntimeGuiObjectReference => Boolean(entry))
    .slice(0, 8);
  if (!visibleRefs.length) return null;
  return (
    <div className="runtime-gui-ref-list" aria-label="Related references">
      {visibleRefs.map((entry) => (
        <RuntimeGuiRefButton key={entry.reference.ref} entry={entry} onObjectFocus={onObjectFocus} />
      ))}
    </div>
  );
}

interface RuntimeGuiObjectReference {
  label: string;
  reference: ObjectReference;
}

function RuntimeGuiRefButton({ entry, onObjectFocus }: { entry: RuntimeGuiObjectReference; onObjectFocus?: (reference: ObjectReference) => void }) {
  const { label, reference } = entry;
  return reference && onObjectFocus ? (
    <button
      type="button"
      className="runtime-gui-ref-button"
      data-object-kind={reference.kind}
      data-preferred-view={reference.preferredView}
      onClick={() => onObjectFocus(reference)}
    >
      {label}
    </button>
  ) : (
    <span className="runtime-gui-ref-chip">{label}</span>
  );
}

function normalizeGuiPresentation(value: unknown): NormalizedGuiPresentation | undefined {
  if (!isRecord(value)) return undefined;
  const displayedRefs = stringList(value.displayedRefs);
  const ref = stringField(value.ref);
  const text = sanitizeRuntimeGuiText(stringField(value.text));
  if (!ref && !displayedRefs.length && !text) return undefined;
  return {
    title: sanitizeRuntimeGuiText(stringField(value.title)),
    text,
    ref,
    status: stringField(value.status),
    displayedRefs,
  };
}

function normalizeGuiAskUser(value: unknown): NormalizedGuiAskUser | undefined {
  if (!isRecord(value)) return undefined;
  const approvalRequest = isRecord(value.approvalRequest) ? value.approvalRequest : {};
  const publicProjection = normalizeGuiPublicProjection([
    value.publicProjection,
    value.public_projection,
    value.projection,
    approvalRequest.publicProjection,
    approvalRequest.public_projection,
    value,
    approvalRequest,
  ]);
  const choices = runtimeGuiChoicesFromEventPayload(value);
  const title = sanitizeRuntimeGuiText(stringField(value.title) ?? stringField(approvalRequest.title)) ?? 'Confirm before continuing';
  const message = sanitizeRuntimeGuiText(stringField(value.message)
    ?? stringField(approvalRequest.prompt)
    ?? stringField(approvalRequest.message)
    ?? stringField(approvalRequest.confirmationText)
    ?? stringField(approvalRequest.confirmation_text)
    ?? stringField(approvalRequest.reason));
  const relatedRefs = uniqueStrings([
    ...stringList(value.relatedRefs),
    ...stringList(value.displayedRefs),
    ...stringList(approvalRequest.refs),
    ...(publicProjection?.evidenceRefs ?? []),
  ]);
  if (!message && !relatedRefs.length && !choices.length && !publicProjection) return undefined;
  return {
    title,
    kind: stringField(value.kind),
    message,
    risk: stringField(approvalRequest.riskLevel) ?? stringField(approvalRequest.risk_level) ?? stringField(approvalRequest.risk),
    publicProjection,
    relatedRefs,
    choices,
  };
}

function normalizeGuiPublicProjection(values: unknown[]): NormalizedGuiPublicProjection | undefined {
  const records = values.filter(isRecord);
  if (!records.length) return undefined;
  const projection = {
    action: firstSanitizedGuiField(records, ['action', 'actionText', 'action_text', 'actionKind', 'action_kind', 'actionType', 'action_type', 'operation', 'verb']),
    target: firstSanitizedGuiField(records, ['target', 'targetSummary', 'target_summary', 'targetObject', 'target_object', 'targetService', 'target_service', 'destination', 'service', 'site']),
    impact: firstSanitizedGuiField(records, ['impact', 'impactSummary', 'impact_summary', 'effect', 'effectSummary', 'effect_summary', 'outcome', 'riskImpact', 'risk_impact']),
    evidenceRefs: uniqueStrings(records.flatMap(guiPublicEvidenceRefsFromRecord)),
    authorizationProfile: records
      .map((record) => guiAuthorizationProfileLabel(
        record.authorizationProfile
          ?? record.authorization_profile
          ?? record.autonomyProfile
          ?? record.autonomy_profile
          ?? record.authorization,
      ))
      .find((label): label is string => Boolean(label)),
  };
  if (!projection.action && !projection.target && !projection.impact && !projection.evidenceRefs.length && !projection.authorizationProfile) return undefined;
  return projection;
}

function firstSanitizedGuiField(records: Record<string, unknown>[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const text = sanitizeRuntimeGuiText(stringField(record[key]));
      if (text) return compactText(text, 140);
    }
  }
  return undefined;
}

function guiAuthorizationProfileLabel(value: unknown): string | undefined {
  const direct = sanitizeRuntimeGuiText(stringField(value));
  if (direct) return compactText(direct, 80);
  if (!isRecord(value)) return undefined;
  return firstSanitizedGuiField([value], ['label', 'name', 'profile', 'id', 'tier']);
}

function guiPublicEvidenceRefsFromRecord(record: Record<string, unknown>) {
  return [
    ...stringList(record.evidenceRefs),
    ...stringList(record.evidence_refs),
    ...stringList(record.displayedRefs),
    ...stringList(record.displayed_refs),
    ...stringList(record.relatedRefs),
    ...stringList(record.related_refs),
    ...stringList(record.refs),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
}

export function sanitizeRuntimeGuiText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || looksLikeRuntimeGuiRawPayload(trimmed)) return undefined;
  const sanitized = (sanitizeUserProjectionText(trimmed) ?? trimmed)
    .replace(/\b(?:raw\s+JSONL?|JSONL|ToolPayload|provider\s+payload|debug\s+payload)\b/gi, 'debug details')
    .replace(/\b(?:stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, 'execution log reference')
    .replace(/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, 'credential=[redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]+/g, '[redacted-secret]')
    .replace(/\bhttps?:\/\/[^\s`"'<>),;]+/gi, '[redacted-url]')
    .replace(/(^|[\s="'(:])\/(?:Applications|Users|Volumes|private|var|tmp)\/[^\s`"'<>),;]+/g, '$1[local path]')
    .replace(/(^|[\s="'(:])\.sciforge\/[^\s`"'<>),;]+/gi, '$1[internal log]')
    .replace(/\b(?:stdout|stderr)\s*=\s*["']?[^"'\s,;)]+/gi, 'execution log=[redacted]')
    .replace(/\bprovider\s*=\s*["']?[^"'\s,;)]+/gi, 'service=[redacted]')
    .replace(/\bmodel\s*=\s*["']?[^"'\s,;)]+/gi, 'runtime=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized || looksLikeRuntimeGuiRawPayload(sanitized)) return undefined;
  return sanitized;
}

function looksLikeRuntimeGuiRawPayload(value: string) {
  const text = value.trim();
  if (/^\s*[\[{]/.test(text)) {
    return /"?(?:provider|model|stdout|stderr|raw|payload|apiKey|token|secret|path|commandText|approvalRequest|displayedRefs)"?\s*:/.test(text);
  }
  return /^(?:provider|stdout|stderr|raw|debug|payload|ToolPayload)\b\s*[:=]/i.test(text) && text.length > 80;
}

function humanGuiTitle(value: string | undefined) {
  if (!value) return undefined;
  const title = value
    .replace(/\bComputer Use confirmation required\b/gi, 'Confirmation required')
    .replace(/\bComputer Use result\b/gi, 'Operation result')
    .replace(/\bComputer Use\b/gi, 'Operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'Operation')
    .replace(/\bcodex-command[-:\w]*\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title ? compactText(title, 80) : undefined;
}

function humanGuiMessage(value: string) {
  return compactText(value
    .replace(/\bComputer Use\b/gi, 'the operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'the operation')
    .replace(/\bcodex-command[-:\w]*\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim(), 220);
}

function humanStatusLabel(value: string) {
  const status = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (status === 'needs confirmation') return 'Needs confirmation';
  if (status === 'completed' || status === 'done') return 'Done';
  if (status === 'failed' || status === 'error') return 'Needs attention';
  return compactText(value, 40);
}

function humanRiskLabel(value: string) {
  const risk = value.trim().toLowerCase();
  if (risk === 'high') return 'High risk';
  if (risk === 'medium') return 'Medium risk';
  if (risk === 'low') return 'Low risk';
  return compactText(value, 40);
}

function runtimeGuiChoiceDisplayLabel(value: string) {
  const label = value.trim();
  if (/^(?:approve|approved|allow|allowed|yes)$/i.test(label)) return 'Confirm';
  if (/^(?:reject|rejected|deny|denied|no)$/i.test(label)) return 'Cancel';
  return compactText(sanitizeRuntimeGuiText(label) ?? 'Continue', 40);
}

function runtimeGuiObjectReference(ref: string): RuntimeGuiObjectReference | undefined {
  const normalized = normalizeRuntimeGuiRef(ref);
  const reference = normalized ? objectReferenceForCursorRef(normalized) : undefined;
  return reference ? { label: displayRuntimeGuiRefLabel(normalized), reference } : undefined;
}

function normalizeRuntimeGuiRef(ref: string) {
  return ref.trim().replace(/^([a-z][a-z0-9+.-]*)::/i, '$1:');
}

function displayRuntimeGuiRefLabel(ref: string) {
  return ref.replace(/^[a-z]+:{1,2}/i, '').replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? ref;
}
