import { objectReferenceKinds } from '../../runtimeContracts';
import type { ObjectReference, SciForgeRun, SciForgeSession } from '../../domain';
import type { RuntimeResolvedViewPlan } from './viewPlanResolver';
import {
  objectReferenceKindLabel,
  objectReferenceForArtifactSummary,
} from '../../../../../packages/support/object-references';
import { isRecord } from './resultArtifactHelpers';
import { rightPaneInlineLabel, rightPaneTextIsSensitive } from './previewSafety';
import { artifactsForRun, auditExecutionUnitsForRun } from './executionUnitsForRun';
import { terminalExecutionUnitFailed } from './terminalPaneModel';
import {
  conversationProjectionAuditRefs,
  conversationProjectionForSession,
} from '../conversation-projection-view-model';

export type RightPaneReferenceGroupKind = ObjectReference['kind'] | 'unsupported';

export interface RightPaneReferenceGroup {
  kind: RightPaneReferenceGroupKind;
  references: ObjectReference[];
}

export type RightPaneReferenceTraceNodeKind =
  | RightPaneReferenceGroupKind
  | 'message'
  | 'claim'
  | 'notebook'
  | 'diagnostic'
  | 'view-plan';

export type RightPaneReferenceTraceRelation =
  | 'declares'
  | 'produces'
  | 'consumes'
  | 'contains'
  | 'presents'
  | 'supports'
  | 'opposes'
  | 'depends-on'
  | 'diagnoses';

export interface RightPaneReferenceTraceNode {
  id: string;
  ref: string;
  kind: RightPaneReferenceTraceNodeKind;
  title: string;
  summary?: string;
  status?: string;
}

export interface RightPaneReferenceTraceEdge {
  id: string;
  sourceRef: string;
  targetRef: string;
  relation: RightPaneReferenceTraceRelation;
  source: 'object-reference' | 'message' | 'run' | 'conversation-projection' | 'execution-unit' | 'view-plan' | 'claim' | 'notebook' | 'diagnostic';
  label?: string;
}

export interface RightPaneReferencesTraceIndex {
  nodes: RightPaneReferenceTraceNode[];
  edges: RightPaneReferenceTraceEdge[];
}

export function rightPaneObjectReferences(session: SciForgeSession, activeRun?: SciForgeRun): ObjectReference[] {
  const activeRunIds = activeRun ? new Set([activeRun.id]) : undefined;
  const resolvedActiveRun = activeRun
    ? session.runs.find((run) => run.id === activeRun.id) ?? activeRun
    : undefined;
  const fromMessages = session.messages.flatMap((message) => message.objectReferences ?? [])
    .filter((reference) => !activeRunIds || !reference.runId || activeRunIds.has(reference.runId));
  const runs = resolvedActiveRun ? [resolvedActiveRun] : session.runs;
  const fromRuns = runs.flatMap((run) => run.objectReferences ?? []);
  const fromArtifacts = (resolvedActiveRun ? artifactsForRun(session, resolvedActiveRun) : session.artifacts)
    .map((artifact) => objectReferenceForArtifactSummary(artifact, resolvedActiveRun?.id));
  const fromExecutionUnits = auditExecutionUnitsForRun(session, resolvedActiveRun).map((unit): ObjectReference => ({
    id: `object-execution-unit-${unit.id}`,
    kind: 'execution-unit',
    title: unit.tool || unit.id,
    ref: `execution-unit:${unit.id}`,
    runId: unit.runId ?? resolvedActiveRun?.id,
    executionUnitId: unit.id,
    status: terminalExecutionUnitFailed(unit) ? 'blocked' : 'available',
    summary: unit.outputRef || unit.stdoutRef || unit.stderrRef || unit.status,
    actions: ['focus-right-pane', 'copy-path'],
    provenance: {
      dataRef: unit.outputRef,
      producer: unit.tool,
    },
  }));
  return dedupeObjectReferences([
    ...fromMessages,
    ...fromRuns,
    ...fromArtifacts,
    ...fromExecutionUnits,
  ]);
}

export function buildRightPaneReferencesTraceIndex({
  session,
  activeRun,
  references = rightPaneObjectReferences(session, activeRun),
  viewPlan,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  references?: readonly ObjectReference[];
  viewPlan?: Pick<RuntimeResolvedViewPlan, 'allItems' | 'diagnostics'>;
}): RightPaneReferencesTraceIndex {
  const nodes = new Map<string, RightPaneReferenceTraceNode>();
  const edges = new Map<string, RightPaneReferenceTraceEdge>();
  const scopedRuns = activeRun ? [session.runs.find((run) => run.id === activeRun.id) ?? activeRun] : session.runs;
  const scopedRunIds = scopedRuns.length ? new Set(scopedRuns.map((run) => run.id)) : undefined;

  const addNode = (node: RightPaneReferenceTraceNode) => {
    if (!rightPaneReferenceRefIsSafe(node.ref)) return;
    if (!node.ref || nodes.has(node.ref)) return;
    nodes.set(node.ref, rightPanePublicTraceNode(node));
  };
  const addEdge = (edge: Omit<RightPaneReferenceTraceEdge, 'id'>) => {
    if (!rightPaneReferenceRefIsSafe(edge.sourceRef) || !rightPaneReferenceRefIsSafe(edge.targetRef)) return;
    if (!edge.sourceRef || !edge.targetRef || edge.sourceRef === edge.targetRef) return;
    const id = `${edge.source}:${edge.relation}:${edge.sourceRef}->${edge.targetRef}`;
    if (!edges.has(id)) edges.set(id, { ...edge, id });
  };
  const addRefNode = (ref: string, fallbackKind: RightPaneReferenceTraceNodeKind, title?: string, summary?: string) => {
    if (!rightPaneReferenceRefIsSafe(ref)) return;
    const kind = knownTraceKindForRef(ref) ?? fallbackKind;
    addNode({
      id: `${kind}-${safeTraceId(ref)}`,
      ref,
      kind,
      title: title || ref,
      summary,
    });
  };

  for (const reference of references) {
    addNode({
      id: reference.id,
      ref: reference.ref,
      kind: rightPaneReferenceKindIsKnown(reference) ? reference.kind : 'unsupported',
      title: reference.title || reference.ref,
      summary: reference.summary,
      status: reference.status,
    });
  }

  for (const message of session.messages) {
    const messageRef = `message:${message.id}`;
    const messageReferences = (message.objectReferences ?? [])
      .filter((reference) => rightPaneObjectReferenceIsVisible(reference) && (!scopedRunIds || !reference.runId || scopedRunIds.has(reference.runId)));
    if (!messageReferences.length) continue;
    addNode({
      id: `message-${message.id}`,
      ref: messageRef,
      kind: 'message',
      title: `message ${message.id}`,
      summary: message.content,
    });
    for (const reference of messageReferences) {
      addRefNode(reference.ref, rightPaneReferenceKindIsKnown(reference) ? reference.kind : 'unsupported', reference.title, reference.summary);
      addEdge({ sourceRef: messageRef, targetRef: reference.ref, relation: 'declares', source: 'message' });
    }
  }

  for (const run of scopedRuns) {
    const runRef = `run:${run.id}`;
    addNode({
      id: `run-${run.id}`,
      ref: runRef,
      kind: 'run',
      title: run.prompt || run.id,
      summary: run.status,
      status: run.status,
    });
    for (const reference of run.objectReferences ?? []) {
      if (!rightPaneObjectReferenceIsVisible(reference)) continue;
      addRefNode(reference.ref, rightPaneReferenceKindIsKnown(reference) ? reference.kind : 'unsupported', reference.title, reference.summary);
      addEdge({ sourceRef: runRef, targetRef: reference.ref, relation: 'declares', source: 'run' });
    }

    const projection = conversationProjectionForSession(session, run);
    for (const ref of conversationProjectionAuditRefs(projection)) {
      addRefNode(ref, knownTraceKindForRef(ref) ?? 'diagnostic', ref);
      addEdge({ sourceRef: runRef, targetRef: ref, relation: ref.startsWith('verifier:') ? 'diagnoses' : 'declares', source: 'conversation-projection' });
    }
    for (const diagnostic of projection?.diagnostics ?? []) {
      const diagnosticRef = `diagnostic:${safeTraceId(`${run.id}:${diagnostic.code ?? diagnostic.message}`)}`;
      addNode({
        id: diagnosticRef,
        ref: diagnosticRef,
        kind: 'diagnostic',
        title: diagnostic.code ?? diagnostic.severity ?? 'diagnostic',
        summary: diagnostic.message,
        status: diagnostic.severity,
      });
      addEdge({ sourceRef: runRef, targetRef: diagnosticRef, relation: 'diagnoses', source: 'diagnostic' });
      for (const ref of diagnostic.refs?.map((item) => item.ref).filter((ref): ref is string => Boolean(ref)) ?? []) {
        addRefNode(ref, knownTraceKindForRef(ref) ?? 'diagnostic', ref);
        addEdge({ sourceRef: diagnosticRef, targetRef: ref, relation: 'declares', source: 'diagnostic' });
      }
    }
  }

  for (const artifact of activeRun ? artifactsForRun(session, activeRun) : session.artifacts) {
    const ref = `artifact:${artifact.id}`;
    addRefNode(ref, 'artifact', artifact.type, artifact.dataRef);
    const runRef = stringField(artifact.metadata?.runId) ?? stringField(artifact.metadata?.producerRunId) ?? stringField(artifact.metadata?.sourceRunId);
    if (runRef && (!scopedRunIds || scopedRunIds.has(runRef))) {
      addEdge({ sourceRef: `run:${runRef}`, targetRef: ref, relation: 'produces', source: 'run' });
    }
  }

  for (const unit of auditExecutionUnitsForRun(session, activeRun)) {
    const unitRef = `execution-unit:${unit.id}`;
    addNode({
      id: `execution-unit-${unit.id}`,
      ref: unitRef,
      kind: 'execution-unit',
      title: unit.tool || unit.id,
      summary: unit.status,
      status: unit.status,
    });
    if (unit.runId) addEdge({ sourceRef: `run:${unit.runId}`, targetRef: unitRef, relation: 'contains', source: 'execution-unit' });
    for (const ref of unit.inputData ?? []) {
      addRefNode(ref, knownTraceKindForRef(ref) ?? 'unsupported', ref);
      addEdge({ sourceRef: ref, targetRef: unitRef, relation: 'consumes', source: 'execution-unit' });
    }
    for (const [ref, label] of [
      [unit.codeRef, 'code'],
      [unit.stdoutRef, 'stdout'],
      [unit.stderrRef, 'stderr'],
      [unit.outputRef, 'output'],
      [unit.diffRef, 'diff'],
      [unit.verificationRef, 'verification'],
      ...(unit.artifacts ?? []).map((ref) => [artifactRef(ref), 'artifact'] as const),
      ...(unit.outputArtifacts ?? []).map((ref) => [artifactRef(ref), 'artifact'] as const),
    ] as Array<readonly [string | undefined, string]>) {
      if (!ref) continue;
      addRefNode(ref, knownTraceKindForRef(ref) ?? 'artifact', ref);
      addEdge({ sourceRef: unitRef, targetRef: ref, relation: 'produces', source: 'execution-unit', label });
    }
  }

  for (const item of viewPlan?.allItems ?? []) {
    const viewRef = `view-plan:${item.id}`;
    addNode({
      id: viewRef,
      ref: viewRef,
      kind: 'view-plan',
      title: item.slot.title ?? item.module.title ?? item.id,
      summary: item.reason ?? item.status,
      status: item.status,
    });
    const runRef = activeRun ? `run:${activeRun.id}` : undefined;
    if (runRef) addEdge({ sourceRef: runRef, targetRef: viewRef, relation: 'presents', source: 'view-plan' });
    const targetRef = artifactRef(item.artifact?.id ?? item.slot.artifactRef);
    if (targetRef) {
      addRefNode(targetRef, 'artifact', item.artifact?.type ?? item.slot.title);
      addEdge({ sourceRef: viewRef, targetRef, relation: 'presents', source: 'view-plan' });
    }
  }
  for (const diagnostic of viewPlan?.diagnostics ?? []) {
    const diagnosticRef = `diagnostic:${safeTraceId(diagnostic)}`;
    addNode({ id: diagnosticRef, ref: diagnosticRef, kind: 'diagnostic', title: 'view-plan diagnostic', summary: diagnostic });
    if (activeRun) addEdge({ sourceRef: `run:${activeRun.id}`, targetRef: diagnosticRef, relation: 'diagnoses', source: 'view-plan' });
  }

  for (const claim of session.claims) {
    const claimRef = `claim:${claim.id}`;
    addNode({
      id: `claim-${claim.id}`,
      ref: claimRef,
      kind: 'claim',
      title: claim.text,
      summary: `${claim.type} ${claim.evidenceLevel}`,
      status: `${claim.confidence}`,
    });
    for (const ref of claim.supportingRefs) {
      addRefNode(ref, knownTraceKindForRef(ref) ?? 'unsupported', ref);
      addEdge({ sourceRef: ref, targetRef: claimRef, relation: 'supports', source: 'claim' });
    }
    for (const ref of claim.opposingRefs) {
      addRefNode(ref, knownTraceKindForRef(ref) ?? 'unsupported', ref);
      addEdge({ sourceRef: ref, targetRef: claimRef, relation: 'opposes', source: 'claim' });
    }
    for (const ref of claim.dependencyRefs ?? []) {
      addRefNode(ref, knownTraceKindForRef(ref) ?? 'unsupported', ref);
      addEdge({ sourceRef: ref, targetRef: claimRef, relation: 'depends-on', source: 'claim' });
    }
  }

  for (const entry of session.notebook) {
    const notebookRef = `notebook:${entry.id}`;
    addNode({
      id: `notebook-${entry.id}`,
      ref: notebookRef,
      kind: 'notebook',
      title: entry.title,
      summary: entry.desc,
      status: `${entry.confidence}`,
    });
    for (const ref of [
      ...(entry.artifactRefs ?? []).map(artifactRef),
      ...(entry.executionUnitRefs ?? []).map(executionUnitRef),
      ...(entry.beliefRefs ?? []),
      ...(entry.dependencyRefs ?? []),
    ].filter((ref): ref is string => Boolean(ref))) {
      addRefNode(ref, knownTraceKindForRef(ref) ?? 'unsupported', ref);
      addEdge({ sourceRef: ref, targetRef: notebookRef, relation: 'declares', source: 'notebook' });
    }
  }

  return {
    nodes: Array.from(nodes.values()).slice(0, 180),
    edges: Array.from(edges.values()).slice(0, 360),
  };
}

export function rightPaneReferenceTraceRows(reference: ObjectReference, index: RightPaneReferencesTraceIndex, maxRows = 4): Array<[string, string]> {
  return index.edges
    .filter((edge) => edge.sourceRef === reference.ref || edge.targetRef === reference.ref)
    .slice(0, maxRows)
    .map((edge) => {
      const outgoing = edge.sourceRef === reference.ref;
      const peer = outgoing ? edge.targetRef : edge.sourceRef;
      const label = edge.label ? `${edge.relation}:${edge.label}` : edge.relation;
      return [
        outgoing ? 'to' : 'from',
        rightPaneInlineLabel(`${label} ${peer}`, 180),
      ] as [string, string];
    });
}

export function groupObjectReferencesByKind(references: readonly ObjectReference[]): RightPaneReferenceGroup[] {
  const order: RightPaneReferenceGroupKind[] = ['artifact', 'file', 'folder', 'url', 'execution-unit', 'run', 'scenario-package', 'unsupported'];
  return order
    .map((kind) => ({
      kind,
      references: kind === 'unsupported'
        ? references.filter((reference) => !rightPaneReferenceKindIsKnown(reference))
        : references.filter((reference) => reference.kind === kind),
    }))
    .filter((group) => group.references.length > 0);
}

export function rightPaneReferenceKindIsKnown(reference: ObjectReference) {
  return objectReferenceKinds.includes(reference.kind);
}

export function rightPaneReferenceKindGroupLabel(kind: RightPaneReferenceGroupKind) {
  return kind === 'unsupported' ? 'unsupported object' : objectReferenceKindLabel(kind);
}

export function rightPaneReferenceProvenanceRows(reference: ObjectReference): Array<[string, string]> {
  const provenance = isRecord(reference.provenance) ? reference.provenance : undefined;
  return [
    ['ref', reference.ref],
    ['run', reference.runId],
    ['unit', reference.executionUnitId],
    ['data', typeof provenance?.dataRef === 'string' ? provenance.dataRef : undefined],
    ['path', typeof provenance?.path === 'string' ? provenance.path : undefined],
    ['producer', typeof provenance?.producer === 'string' ? provenance.producer : undefined],
    ['version', typeof provenance?.version === 'string' ? provenance.version : undefined],
    ['hash', typeof provenance?.hash === 'string' ? provenance.hash : undefined],
    ['screenshot', typeof provenance?.screenshotRef === 'string' ? provenance.screenshotRef : undefined],
    ['size', typeof provenance?.size === 'number' ? `${provenance.size} bytes` : undefined],
  ].flatMap(([key, value]) => {
    if (typeof value !== 'string' || !value.trim()) return [];
    return [[key, rightPaneInlineLabel(value, 180)] as [string, string]];
  }).slice(0, 8);
}

export function rightPaneCopyableReferenceText(ref: string) {
  return rightPaneInlineLabel(ref, 400);
}

function dedupeObjectReferences(references: readonly ObjectReference[]) {
  const byKey = new Map<string, ObjectReference>();
  for (const reference of references) {
    const visibleReference = rightPaneVisibleObjectReference(reference);
    if (!visibleReference?.ref || !visibleReference.kind) continue;
    const key = `${visibleReference.kind}:${visibleReference.ref}`;
    if (!byKey.has(key)) byKey.set(key, visibleReference);
  }
  return Array.from(byKey.values()).slice(0, 60);
}

function rightPaneVisibleObjectReference(reference: ObjectReference): ObjectReference | undefined {
  if (!reference?.kind) return undefined;
  if (rightPaneObjectReferenceIsVisible(reference)) return rightPanePublicObjectReference(reference);
  const fallbackRef = rightPaneUnsupportedReferenceFallbackRef(reference);
  if (!fallbackRef) return undefined;
  const { raw: _raw, provenance: _provenance, ...publicReference } = reference as ObjectReference & { raw?: unknown };
  return rightPanePublicObjectReference({
    ...publicReference,
    ref: fallbackRef,
    status: reference.status ?? 'blocked',
    provenance: {
      ...reference.provenance,
      dataRef: fallbackRef,
      path: undefined,
      screenshotRef: undefined,
    },
  });
}

function rightPanePublicObjectReference(reference: ObjectReference): ObjectReference {
  const { raw: _raw, ...publicReference } = reference as ObjectReference & { raw?: unknown };
  const title = rightPanePublicOptionalText(publicReference.title);
  const summary = rightPanePublicOptionalText(publicReference.summary);
  return {
    ...publicReference,
    title: title ?? publicReference.ref,
    summary,
    provenance: rightPanePublicReferenceProvenance(publicReference.provenance),
  };
}

function rightPanePublicReferenceProvenance(provenance: ObjectReference['provenance']): ObjectReference['provenance'] {
  if (!provenance) return provenance;
  return {
    ...provenance,
    producer: rightPanePublicOptionalText(provenance.producer),
    version: rightPanePublicOptionalText(provenance.version),
    hash: rightPanePublicOptionalText(provenance.hash),
  };
}

function rightPanePublicTraceNode(node: RightPaneReferenceTraceNode): RightPaneReferenceTraceNode {
  return {
    ...node,
    title: rightPanePublicOptionalText(node.title) ?? node.ref,
    summary: rightPanePublicOptionalText(node.summary),
  };
}

function rightPanePublicOptionalText(value: string | undefined) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return rightPaneInlineLabel(value, 180);
}

function rightPaneObjectReferenceIsVisible(reference: ObjectReference) {
  return rightPaneReferenceRefIsSafe(reference.ref)
    && rightPaneReferenceRefIsSafe(reference.provenance?.path)
    && rightPaneReferenceRefIsSafe(reference.provenance?.dataRef)
    && rightPaneReferenceRefIsSafe(reference.provenance?.screenshotRef);
}

function rightPaneUnsupportedReferenceFallbackRef(reference: ObjectReference) {
  if (rightPaneReferenceKindIsKnown(reference)) return undefined;
  const dataRef = typeof reference.provenance?.dataRef === 'string' ? reference.provenance.dataRef : undefined;
  if (!dataRef || !rightPaneReferenceRefIsSafe(dataRef)) return undefined;
  return dataRef;
}

function rightPaneReferenceRefIsSafe(value: string | undefined) {
  const ref = value?.trim().replace(/\\/g, '/');
  if (!ref) return true;
  if (rightPaneTextIsSensitive(ref)) return false;
  if (/^(?:\/|[A-Za-z]:\/|~\/|file:\/\/|file:(?:\/|[A-Za-z]:\/|~\/))/i.test(ref)) return false;
  if (ref.includes('..')) return false;
  if (/[\r\n\t<>|?*]/.test(ref)) return false;
  if (/(?:^|[/:])\.sciforge\/(?:raw|logs?|audit|stdout|stderr)(?:\/|$)/i.test(ref)) return false;
  if (/(?:^|[/:._-])(?:provider|debug|raw|stdout|stderr)(?:$|[/:._-])/i.test(ref)) return false;
  return true;
}

function knownTraceKindForRef(ref: string): RightPaneReferenceTraceNodeKind | undefined {
  if (/^artifact:/i.test(ref)) return 'artifact';
  if (/^file:/i.test(ref)) return 'file';
  if (/^folder:/i.test(ref) || /^workspace:/i.test(ref)) return 'folder';
  if (/^run:/i.test(ref)) return 'run';
  if (/^(?:subagent|agent-result|agent-transcript|transcript):/i.test(ref)) return 'run';
  if (/^execution-unit:/i.test(ref)) return 'execution-unit';
  if (/^(?:url:)?https?:\/\//i.test(ref) || /^url:/i.test(ref)) return 'url';
  if (/^scenario-package:/i.test(ref)) return 'scenario-package';
  if (/^claim:/i.test(ref)) return 'claim';
  if (/^notebook:/i.test(ref)) return 'notebook';
  if (/^diagnostic:|^verifier:/i.test(ref)) return 'diagnostic';
  if (/^view-plan:/i.test(ref)) return 'view-plan';
  return undefined;
}

function artifactRef(ref: string | undefined) {
  if (!ref) return '';
  return ref.startsWith('artifact:') ? ref : `artifact:${ref}`;
}

function executionUnitRef(ref: string | undefined) {
  if (!ref) return '';
  return ref.startsWith('execution-unit:') ? ref : `execution-unit:${ref}`;
}

function safeTraceId(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 80) || 'unknown';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
