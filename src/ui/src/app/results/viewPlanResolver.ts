import { uiModuleRegistry, type RuntimeUIModule } from '../../uiModuleRegistry';
import type { DisplayIntent, ObjectReference, PresentationInput, ResolvedViewPlan, RuntimeArtifact, ScenarioInstanceId, SciForgeRun, SciForgeSession, UIManifestSlot, ViewPlanSection } from '../../domain';
import type { ScenarioId } from '../../data';
import {
  artifactForObjectReference,
  artifactHasUserFacingDelivery,
  syntheticArtifactForObjectReference,
} from '../../../../../packages/support/object-references';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionForSession,
  conversationProjectionPrimaryDiagnostic,
  conversationProjectionVisibleText,
  type UiConversationProjection,
} from '../conversation-projection-view-model';
import { auditExecutionUnitsForRun } from './executionUnitsForRun';
import type { ResultFocusMode } from './ResultShell';
import {
  blockedInteractiveViewDesignForIntent,
  componentConsumesPresentationInput,
  componentMatchesInteractiveViewFocus,
  compactInteractiveViewPlanItems,
  compareInteractiveViewPlanOrder,
  compareInteractiveViewResultPresentationItems,
  findBestInteractiveArtifactForModule,
  findBestInteractiveArtifactForType,
  findBestInteractiveViewModuleForArtifact,
  findBestInteractiveViewModuleForArtifactType,
  findInteractiveViewModuleById,
  findInteractiveViewModuleForObjectReference,
  findRenderableInteractiveArtifact,
  interactiveViewFallbackModuleIds,
  interactiveViewPlanSourceIds,
  interactiveViewVisiblePresentationGroupKey,
  isAuditOnlyInteractiveViewPlanItem,
  isEvidenceInteractiveArtifactType,
  isEvidenceInteractiveViewComponent,
  resolvePresentationInputForArtifact,
  resolveInteractiveViewPlanSection,
  validateInteractiveViewModuleBinding,
  type InteractiveViewBindingStatus,
  type InteractiveViewPlanSource,
} from '../../../../../packages/presentation/interactive-views';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

type ViewPlanSource = InteractiveViewPlanSource;
type ViewPlanBindingStatus = InteractiveViewBindingStatus;

type ResultPresentationArtifactAction = {
  id?: string;
  label?: string;
  ref?: string;
  artifactType?: string;
  componentId?: string;
  moduleId?: string;
  presentationKey?: string;
  parentArtifactRef?: string;
  revision?: string | number;
  revisionRef?: string;
  encoding?: UIManifestSlot['encoding'];
  layout?: UIManifestSlot['layout'];
  selection?: UIManifestSlot['selection'];
  sync?: UIManifestSlot['sync'];
  transform?: UIManifestSlot['transform'];
  compare?: UIManifestSlot['compare'];
  exportProfile?: Record<string, unknown>;
};

export type ResolvedViewPlanItem = {
  id: string;
  slot: UIManifestSlot;
  module: RuntimeUIModule;
  artifact?: RuntimeArtifact;
  input?: PresentationInput;
  section: ViewPlanSection;
  source: ViewPlanSource;
  status: ViewPlanBindingStatus;
  reason?: string;
  missingFields?: string[];
};

export function scopedResultSlotId(runId: string | undefined, itemId: string) {
  return runId ? `${runId}:${itemId}` : itemId;
}

export function filterHiddenResultSlots(items: ResolvedViewPlanItem[], session: SciForgeSession, activeRun?: SciForgeRun): ResolvedViewPlanItem[] {
  const hidden = session.hiddenResultSlotIds;
  if (!hidden?.length) return items;
  const drop = new Set(hidden);
  return items.filter((item) => !drop.has(item.id) && !drop.has(scopedResultSlotId(activeRun?.id, item.id)));
}

export type RuntimeResolvedViewPlan = Omit<ResolvedViewPlan, 'sections'> & {
  sections: Record<ViewPlanSection, ResolvedViewPlanItem[]>;
  allItems: ResolvedViewPlanItem[];
};

export interface HandoffAutoRunRequest {
  id: string;
  targetScenario: ScenarioInstanceId;
  prompt: string;
}

export function resolveViewPlan({
  scenarioId,
  session,
  defaultSlots,
  activeRun,
  focusedObjectReference,
  pinnedObjectReferences = [],
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  defaultSlots?: UIManifestSlot[];
  activeRun?: SciForgeRun;
  focusedObjectReference?: ObjectReference;
  pinnedObjectReferences?: ObjectReference[];
}): RuntimeResolvedViewPlan {
  const effectiveRun = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, effectiveRun);
  const resultArtifacts = projection
    ? artifactsForConversationProjection(session, projection)
    : [];
  const resultExecutionUnits: [] = [];
  const displayIntent = projection
    ? displayIntentFromConversationProjection(projection, resultArtifacts)
    : projectionlessDisplayIntent();
  const presentationArtifactActions = projection
    ? projectionArtifactActions(projection, resultArtifacts)
    : [];
  const presentationActionArtifactIds = new Set(presentationArtifactActions
    .map((action) => stripArtifactRef(action.ref ?? ''))
    .filter(Boolean));
  const runtimeSlots = session.runs.length && session.uiManifest.length ? session.uiManifest : [];
  const projectionArtifactIds = projection ? new Set(resultArtifacts.map((artifact) => artifact.id)) : undefined;
  const projectionRuntimeSlots = projectionArtifactIds
    ? runtimeSlots.filter((slot) => slot.artifactRef && projectionArtifactIds.has(stripArtifactRef(slot.artifactRef)))
    : runtimeSlots;
  const seedSlots = (projection
    ? projectionRuntimeSlots
    : [])
    .slice()
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const diagnostics: string[] = projection ? [] : projectionlessAuditDiagnostics(session, effectiveRun);
  const items: ResolvedViewPlanItem[] = [];
  const seen = new Set<string>();

  const addItem = (
    module: RuntimeUIModule,
    artifact: RuntimeArtifact | undefined,
    source: ViewPlanSource,
    overrides: Partial<UIManifestSlot> = {},
    reason?: string,
    itemIdentity?: string,
  ) => {
    const slot: UIManifestSlot = {
      componentId: overrides.componentId ?? module.componentId,
      title: overrides.title ?? module.title,
      artifactRef: overrides.artifactRef ?? artifact?.id,
      priority: overrides.priority ?? module.priority,
      props: overrides.props,
      encoding: overrides.encoding,
      layout: overrides.layout,
      selection: overrides.selection,
      sync: overrides.sync,
      transform: overrides.transform,
      compare: overrides.compare,
    };
    const input = resolvePresentationInputForArtifact(artifact);
    const validation = validateInteractiveViewModuleBinding(module, artifact, input);
    if (!artifact && validation.status === 'missing-artifact') return;
    const section = resolveInteractiveViewPlanSection({ module, displayIntent, artifact, source });
    const id = `${section}-${module.moduleId}-${itemIdentity ?? artifact?.id ?? slot.artifactRef ?? slot.componentId}`;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      slot,
      module,
      artifact,
      input,
      section,
      source,
      status: validation.status,
      reason: reason ?? validation.reason,
      missingFields: validation.missingFields,
    });
  };

  for (const reference of [focusedObjectReference, ...pinnedObjectReferences].filter((item): item is ObjectReference => Boolean(item))) {
    const resolvedArtifact = artifactForObjectReference(reference, session);
    if (resolvedArtifact && !artifactHasUserFacingDelivery(resolvedArtifact)) continue;
    const artifact = resolvedArtifact ?? syntheticArtifactForObjectReference(reference, scenarioId);
    if (artifact?.delivery && !artifactHasUserFacingDelivery(artifact)) continue;
    const module = findInteractiveViewModuleForObjectReference({ reference, artifact, modules: uiModuleRegistry })
      ?? (artifact ? findBestInteractiveViewModuleForArtifact(uiModuleRegistry, artifact) : findInteractiveViewModuleById(uiModuleRegistry, interactiveViewFallbackModuleIds.genericInspector));
    if (module) {
      addItem(module, artifact, interactiveViewPlanSourceIds.objectFocus, {
        title: reference.title,
        artifactRef: artifact?.id ?? reference.ref,
        priority: -10,
      }, reference.summary || `object reference ${reference.ref}`);
    }
  }

  for (const moduleId of displayIntent.preferredModules ?? []) {
    const module = findInteractiveViewModuleById(uiModuleRegistry, moduleId);
    if (!module) {
      diagnostics.push(`UI module 未发布：${moduleId}`);
      continue;
    }
    addItem(module, findBestInteractiveArtifactForModule(resultArtifacts, module), interactiveViewPlanSourceIds.displayIntent);
  }

  presentationArtifactActions.forEach((action, index) => {
    const artifact = artifactForPresentationAction(resultArtifacts, action);
    const module = moduleForPresentationAction(action, artifact, displayIntent.preferredModules);
    if (!module) {
      diagnostics.push(`resultPresentation artifactAction 无可用 UI module：${action.ref ?? action.artifactType ?? action.id ?? index}`);
      return;
    }
    addItem(module, artifact, interactiveViewPlanSourceIds.displayIntent, {
      title: action.label ?? artifact?.id ?? action.artifactType ?? module.title,
      artifactRef: artifact?.id ?? action.ref ?? action.artifactType,
      priority: index,
      props: actionSlotProps(action, artifact),
      encoding: action.encoding,
      layout: action.layout,
      selection: action.selection,
      sync: action.sync,
      transform: action.transform,
      compare: action.compare,
    }, artifact ? undefined : `等待 resultPresentation artifact ${action.ref ?? action.artifactType ?? action.id ?? index}`, presentationActionItemIdentity(action, artifact, index));
  });

  for (const artifactType of displayIntent.requiredArtifactTypes ?? []) {
    if (presentationArtifactActions.some((action) => action.artifactType === artifactType && (action.ref || findBestInteractiveArtifactForType(resultArtifacts, artifactType)))) continue;
    const artifact = findBestInteractiveArtifactForType(resultArtifacts, artifactType);
    const module = findBestInteractiveViewModuleForArtifactType(uiModuleRegistry, artifact?.type ?? artifactType, displayIntent.preferredModules);
    if (module) {
      addItem(module, artifact, interactiveViewPlanSourceIds.displayIntent, {}, artifact ? undefined : `等待 artifact type=${artifactType}`);
    } else {
      diagnostics.push(`没有已发布 UI module 可消费 artifact type=${artifactType}`);
    }
  }

  for (const artifact of resultArtifacts.slice(0, 12)) {
    if (presentationActionArtifactIds.has(artifact.id)) continue;
    const module = findBestInteractiveViewModuleForArtifact(uiModuleRegistry, artifact);
    if (module) addItem(
      module,
      artifact,
      interactiveViewPlanSourceIds.artifactInferred,
    );
  }

  for (const slot of seedSlots) {
    const artifact = findRenderableInteractiveArtifact(resultArtifacts, slot.artifactRef);
    const input = resolvePresentationInputForArtifact(artifact);
    const currentModule = uiModuleRegistry.find((module) => module.componentId === slot.componentId && componentConsumesPresentationInput(module, input));
    const replacementModule = artifact ? findBestInteractiveViewModuleForArtifact(uiModuleRegistry, artifact) : uiModuleRegistry.find((module) => module.componentId === slot.componentId);
    const module = currentModule ?? replacementModule ?? findInteractiveViewModuleById(uiModuleRegistry, interactiveViewFallbackModuleIds.genericInspector);
    if (!module) continue;
    if (artifact && slot.componentId !== module.componentId) {
      diagnostics.push(`${slot.componentId} -> ${artifact.type} 已改由 ${module.componentId} 渲染，避免组件/artifact 错配。`);
    }
    addItem(module, artifact, runtimeSlots.includes(slot) ? interactiveViewPlanSourceIds.runtimeManifest : interactiveViewPlanSourceIds.defaultPlan, {
      ...slot,
      componentId: module.componentId,
      title: slot.title ?? module.title,
      artifactRef: artifact?.id ?? slot.artifactRef,
      priority: slot.priority ?? module.priority,
    });
  }

  if (session.claims.length || resultArtifacts.some((artifact) => isEvidenceInteractiveArtifactType(artifact.type))) {
    addItem(findInteractiveViewModuleById(uiModuleRegistry, interactiveViewFallbackModuleIds.evidenceMatrix) ?? uiModuleRegistry[3], undefined, interactiveViewPlanSourceIds.fallback);
  }
  if (resultExecutionUnits.length) {
    addItem(findInteractiveViewModuleById(uiModuleRegistry, interactiveViewFallbackModuleIds.executionProvenance) ?? uiModuleRegistry[4], undefined, interactiveViewPlanSourceIds.fallback);
  }

  let ordered = compactInteractiveViewPlanItems(items, {
    artifacts: resultArtifacts,
    claimCount: session.claims.length,
    executionUnitCount: resultExecutionUnits.length,
    notebookEntryCount: session.notebook.length,
  }).sort(compareInteractiveViewPlanOrder);
  if (!ordered.length) {
    ordered = [];
  }
  const sections: RuntimeResolvedViewPlan['sections'] = {
    primary: [],
    supporting: [],
    provenance: [],
    raw: [],
  };
  ordered.forEach((item) => sections[item.section].push(item));

  const blockedDesign = blockedInteractiveViewDesignForIntent({
    displayIntent,
    artifacts: resultArtifacts,
    items: ordered,
    modules: uiModuleRegistry,
    resumeRunId: effectiveRun?.id,
  });
  return {
    displayIntent,
    diagnostics,
    sections,
    allItems: ordered,
    blockedDesign,
  };
}

function displayIntentFromConversationProjection(
  projection: UiConversationProjection,
  artifacts: RuntimeArtifact[],
): DisplayIntent {
  const artifactTypes = uniqueStrings([
    ...projectionArtifactActions(projection, artifacts)
      .map((action) => action.artifactType)
      .filter((type): type is string => Boolean(type)),
    ...artifacts.map((artifact) => artifact.type),
  ]);
  const firstProjectionArtifact = projection.artifacts.find((artifact) => artifact.label || artifact.ref);
  return {
    primaryGoal: conversationProjectionVisibleText(projection)
      ?? firstProjectionArtifact?.label
      ?? conversationProjectionPrimaryDiagnostic(projection)
      ?? '展示 ConversationProjection 产物',
    requiredArtifactTypes: artifactTypes,
    preferredModules: [],
    fallbackAcceptable: [],
    acceptanceCriteria: ['render-from-conversation-projection'],
    source: 'runtime-artifact',
  };
}

function projectionlessDisplayIntent(): DisplayIntent {
  return {
    primaryGoal: '等待 ConversationProjection',
    requiredArtifactTypes: [],
    preferredModules: [],
    fallbackAcceptable: [],
    acceptanceCriteria: ['wait-for-conversation-projection'],
    source: 'runtime-artifact',
  };
}

function projectionArtifactActions(
  projection: UiConversationProjection,
  artifacts: RuntimeArtifact[],
): ResultPresentationArtifactAction[] {
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const projectionArtifactsByRef = new Map(projection.artifacts.map((artifact) => [artifact.ref, artifact]));
  return uniqueStrings([
    ...conversationProjectionArtifactRefs(projection),
    ...projection.artifacts.map((artifact) => artifact.ref),
  ])
    .filter((ref) => ref.startsWith('artifact:'))
    .map((ref, index) => {
      const id = stripArtifactRef(ref);
      const artifact = artifactsById.get(id);
      const projectionArtifact = projectionArtifactsByRef.get(ref)
        ?? projectionArtifactsByRef.get(`artifact:${id}`)
        ?? projectionArtifactsByRef.get(`artifact::${id}`);
      return {
        id: `projection-artifact-${index}`,
        label: projectionArtifact?.label ?? artifactTitle(artifact) ?? artifact?.id ?? id,
        ref,
        artifactType: artifact?.type ?? projectionArtifact?.mime,
      };
    })
    .filter((action) => action.ref || action.artifactType);
}

function actionSlotProps(action: ResultPresentationArtifactAction, artifact?: RuntimeArtifact): Record<string, unknown> | undefined {
  const artifactIdentity = compactRecord({
    actionId: action.id,
    presentationKey: action.presentationKey,
    artifactRef: artifact?.id ?? action.ref,
    artifactType: artifact?.type ?? action.artifactType,
    parentArtifactRef: action.parentArtifactRef,
    revision: action.revision,
    revisionRef: action.revisionRef,
    transformParams: compactRecord({
      encoding: action.encoding,
      layout: action.layout,
      selection: action.selection,
      sync: action.sync,
      transform: action.transform,
      compare: action.compare,
      exportProfile: action.exportProfile,
    }),
  });
  if (!artifactIdentity) return undefined;
  return {
    artifactIdentity,
  };
}

function presentationActionItemIdentity(action: ResultPresentationArtifactAction, artifact: RuntimeArtifact | undefined, index: number) {
  const viewKey = compactRecord({
    encoding: action.encoding,
    layout: action.layout,
    selection: action.selection,
    sync: action.sync,
    transform: action.transform,
    compare: action.compare,
    exportProfile: action.exportProfile,
  });
  const segments = uniqueStrings([
    artifact?.id ?? action.ref ?? action.artifactType ?? '',
    action.id ? `action:${action.id}` : '',
    action.presentationKey ? `presentation:${action.presentationKey}` : '',
    action.revisionRef ? `revision-ref:${action.revisionRef}` : '',
    action.revision !== undefined ? `revision:${String(action.revision)}` : '',
    viewKey ? `view:${textDigest(JSON.stringify(viewKey))}` : '',
    `index:${index}`,
  ]);
  return segments.join(':');
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined && (!isRecord(entry) || Object.keys(entry).length > 0));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function textDigest(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function artifactForPresentationAction(artifacts: RuntimeArtifact[], action: ResultPresentationArtifactAction) {
  const ref = stripArtifactRef(action.ref ?? '');
  return artifacts.find((artifact) => artifact.id === ref || artifact.id === action.ref || artifact.path === action.ref || artifact.dataRef === action.ref)
    ?? (action.artifactType ? findBestInteractiveArtifactForType(artifacts, action.artifactType) : undefined);
}

function moduleForPresentationAction(action: ResultPresentationArtifactAction, artifact?: RuntimeArtifact, preferredModules: string[] = []) {
  const explicitModule = action.moduleId || action.componentId;
  if (explicitModule) {
    const module = findInteractiveViewModuleById(uiModuleRegistry, explicitModule)
      ?? uiModuleRegistry.find((candidate) => candidate.componentId === explicitModule);
    if (module && (!artifact || componentConsumesPresentationInput(module, resolvePresentationInputForArtifact(artifact)))) return module;
  }
  if (artifact) return findBestInteractiveViewModuleForArtifact(uiModuleRegistry, artifact);
  if (action.artifactType) return findBestInteractiveViewModuleForArtifactType(uiModuleRegistry, action.artifactType, preferredModules);
  return undefined;
}

function stripArtifactRef(value: string) {
  return value.replace(/^artifact::?/i, '');
}

function artifactsForConversationProjection(session: SciForgeSession, projection: UiConversationProjection) {
  const refs = uniqueStrings([
    ...conversationProjectionArtifactRefs(projection),
    ...projection.artifacts.map((artifact) => artifact.ref),
  ]);
  const byId = new Map(session.artifacts.map((artifact) => [artifact.id, artifact]));
  const byRef = new Map(session.artifacts.flatMap((artifact) => [
    [`artifact:${artifact.id}`, artifact],
    [`artifact::${artifact.id}`, artifact],
    [artifact.path, artifact],
    [artifact.dataRef, artifact],
  ].filter((entry): entry is [string, RuntimeArtifact] => Boolean(entry[0]))));
  const ordered = refs
    .map((ref) => byRef.get(ref) ?? byId.get(stripArtifactRef(ref)))
    .filter((artifact): artifact is RuntimeArtifact => Boolean(artifact));
  const unique = new Map<string, RuntimeArtifact>();
  for (const artifact of ordered) {
    if (!unique.has(artifact.id)) unique.set(artifact.id, artifact);
  }
  return Array.from(unique.values()).filter(isUserVisibleDeliveryArtifact);
}

function isUserVisibleDeliveryArtifact(artifact: RuntimeArtifact) {
  return artifactHasUserFacingDelivery(artifact);
}

function projectionlessAuditDiagnostics(session: SciForgeSession, activeRun?: SciForgeRun) {
  return projectionlessRunHasAuditMaterial(session, activeRun)
    ? ['没有 ConversationProjection；raw run、resultPresentation、validation 与 ExecutionUnit 仅作为审计材料，不生成主 view plan。']
    : [];
}

function projectionlessRunHasBlockingAudit(session: SciForgeSession, activeRun?: SciForgeRun) {
  const raw = isRecord(activeRun?.raw) ? activeRun.raw : undefined;
  const rawStatus = String(raw?.status ?? '').trim().toLowerCase();
  return Boolean(
    activeRun?.status === 'failed'
    || ['failed', 'repair-needed', 'needs-human'].includes(rawStatus)
    || asString(raw?.failureReason)
    || asString(raw?.blocker)
    || rawHasValidationFailure(raw)
    || auditExecutionUnitsForRun(session, activeRun).some((unit) => isBlockingExecutionUnitStatus(unit.status)),
  );
}

function projectionlessRunHasAuditMaterial(session: SciForgeSession, activeRun?: SciForgeRun) {
  const raw = isRecord(activeRun?.raw) ? activeRun.raw : undefined;
  return Boolean(
    projectionlessRunHasBlockingAudit(session, activeRun)
    || isRecord(raw?.resultPresentation)
    || isRecord(raw?.displayIntent)
    || auditExecutionUnitsForRun(session, activeRun).length,
  );
}

function rawHasValidationFailure(raw: Record<string, unknown> | undefined) {
  if (!raw) return false;
  return Boolean(
    raw.contractValidationFailure
    || raw.validationFailure
    || raw.failure
    || (Array.isArray(raw.contractValidationFailures) && raw.contractValidationFailures.length)
    || (Array.isArray(raw.validationFailures) && raw.validationFailures.length)
    || (Array.isArray(raw.failures) && raw.failures.length),
  );
}

function isBlockingExecutionUnitStatus(status: unknown) {
  return status === 'failed'
    || status === 'failed-with-reason'
    || status === 'repair-needed'
    || status === 'needs-human';
}

function artifactTitle(artifact?: RuntimeArtifact) {
  const metadata = isRecord(artifact?.metadata) ? artifact.metadata : {};
  return asString(metadata.title) ?? asString(metadata.label) ?? asString(metadata.name);
}

export function itemsForFocusMode(plan: RuntimeResolvedViewPlan, focusMode: ResultFocusMode) {
  const sections = focusMode === 'evidence'
    ? ['supporting'] as ViewPlanSection[]
    : focusMode === 'execution'
      ? ['provenance'] as ViewPlanSection[]
      : ['primary', 'supporting', 'provenance', 'raw'] as ViewPlanSection[];
  return sections.flatMap((section) => plan.sections[section])
    .filter((item) => itemMatchesFocusMode(item, focusMode));
}

function itemMatchesFocusMode(item: ResolvedViewPlanItem, focusMode: ResultFocusMode) {
  if (focusMode === 'execution' && item.section === 'provenance') return true;
  if (focusMode === 'evidence' && isEvidenceInteractiveViewComponent(item.artifact?.type ?? '')) return true;
  return componentMatchesInteractiveViewFocus(item.module.componentId, focusMode);
}



export function viewPlanSectionLabel(section: ViewPlanSection) {
  if (section === 'primary') return '核心结果';
  if (section === 'supporting') return '支撑证据';
  if (section === 'provenance') return '执行记录';
  return '原始数据 / fallback';
}

export function selectDefaultResultItems(items: ResolvedViewPlanItem[], focusMode: ResultFocusMode) {
  const sorted = [...items].sort(compareResultPresentationItems);
  const focused = sorted.filter((item) => item.source === 'object-focus');
  if (focused.length && focusMode === 'all') {
    const visibleItems: ResolvedViewPlanItem[] = [];
    pushUniqueVisibleItems(visibleItems, focused, 2);
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    return {
      visibleItems,
      deferredItems: sorted.filter((item) => !visibleIds.has(item.id) && !isAuditOnlyInteractiveViewPlanItem(item)),
    };
  }
  if (focusMode === 'evidence' || focusMode === 'execution') {
    const visibleItems: ResolvedViewPlanItem[] = [];
    pushUniqueVisibleItems(visibleItems, sorted, 4);
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    return {
      visibleItems,
      deferredItems: sorted.filter((item) => !visibleIds.has(item.id)),
    };
  }
  const userFacing = sorted.filter((item) => !isAuditOnlyInteractiveViewPlanItem(item));
  const primary = userFacing.filter((item) => item.section === 'primary');
  const usefulPrimary = primary.filter((item) => item.status === 'bound' || item.status === 'missing-fields');
  const visibleItems: ResolvedViewPlanItem[] = [];
  pushUniqueVisibleItems(visibleItems, usefulPrimary.length ? usefulPrimary : primary, 2);
  if (visibleItems.length < 2) {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    pushUniqueVisibleItems(
      visibleItems,
      userFacing.filter((item) => !visibleIds.has(item.id) && item.section === 'supporting' && item.status === 'bound'),
      2,
    );
  }
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  return {
    visibleItems,
    deferredItems: userFacing.filter((item) => !visibleIds.has(item.id)),
  };
}

function compareResultPresentationItems(left: ResolvedViewPlanItem, right: ResolvedViewPlanItem) {
  const displayIntentPriority = displayIntentPriorityDelta(left, right);
  if (displayIntentPriority) return displayIntentPriority;
  return compareInteractiveViewResultPresentationItems(left, right);
}

function displayIntentPriorityDelta(left: ResolvedViewPlanItem, right: ResolvedViewPlanItem) {
  if (left.source !== interactiveViewPlanSourceIds.displayIntent || right.source !== interactiveViewPlanSourceIds.displayIntent) return 0;
  if (left.section !== right.section || left.status !== right.status) return 0;
  const leftPriority = left.slot.priority ?? left.module.priority ?? 99;
  const rightPriority = right.slot.priority ?? right.module.priority ?? 99;
  return leftPriority - rightPriority;
}

function pushUniqueVisibleItems(target: ResolvedViewPlanItem[], candidates: ResolvedViewPlanItem[], limit: number) {
  const visibleKeys = new Set(target.map(interactiveViewVisiblePresentationGroupKey));
  for (const item of candidates) {
    if (target.length >= limit) break;
    const key = interactiveViewVisiblePresentationGroupKey(item);
    if (visibleKeys.has(key)) continue;
    visibleKeys.add(key);
    target.push(item);
  }
}
