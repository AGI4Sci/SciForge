import { compileSlotsForScenario } from '@sciforge/scenario-core/ui-plan-compiler';
import { uiModuleRegistry, type RuntimeUIModule } from '../../uiModuleRegistry';
import type { DisplayIntent, ObjectReference, ResolvedViewPlan, RuntimeArtifact, ScenarioInstanceId, SciForgeRun, SciForgeSession, UIManifestSlot, ViewPlanSection } from '../../domain';
import type { ScenarioId } from '../../data';
import { artifactForObjectReference, syntheticArtifactForObjectReference } from '../../../../../packages/support/object-references';
import { artifactsForRun, executionUnitsForRun } from './executionUnitsForRun';
import type { ResultFocusMode } from './ResultShell';
import {
  blockedInteractiveViewDesignForIntent,
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
  inferDisplayIntentFromInteractiveArtifacts,
  interactiveViewFallbackModuleIds,
  interactiveViewModuleAcceptsArtifact,
  interactiveViewPlanSourceIds,
  interactiveViewVisiblePresentationGroupKey,
  isAuditOnlyInteractiveViewPlanItem,
  isEvidenceInteractiveArtifactType,
  isEvidenceInteractiveViewComponent,
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

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
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
  section: ViewPlanSection;
  source: ViewPlanSource;
  status: ViewPlanBindingStatus;
  reason?: string;
  missingFields?: string[];
};

export function filterHiddenResultSlots(items: ResolvedViewPlanItem[], session: SciForgeSession): ResolvedViewPlanItem[] {
  const hidden = session.hiddenResultSlotIds;
  if (!hidden?.length) return items;
  const drop = new Set(hidden);
  return items.filter((item) => !drop.has(item.id));
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

function defaultSlotsForAgent(scenarioId: ScenarioId): UIManifestSlot[] {
  return compileSlotsForScenario(scenarioId);
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
  const resultArtifacts = artifactsForResultPresentation(session, effectiveRun);
  const resultExecutionUnits = executionUnitsForRun(session, effectiveRun);
  const displayIntent = effectiveRun?.status === 'failed'
    ? inferDisplayIntentFromInteractiveArtifacts(resultArtifacts, uiModuleRegistry)
    : extractDisplayIntent(effectiveRun) ?? inferDisplayIntentFromInteractiveArtifacts(resultArtifacts, uiModuleRegistry);
  const presentationArtifactActions = resultPresentationArtifactActions(effectiveRun);
  const presentationActionArtifactIds = new Set(presentationArtifactActions
    .map((action) => stripArtifactRef(action.ref ?? ''))
    .filter(Boolean));
  const runtimeSlots = session.runs.length && session.uiManifest.length ? session.uiManifest : [];
  const seedSlots = (runtimeSlots.length ? runtimeSlots : defaultSlots?.length ? defaultSlots : defaultSlotsForAgent(scenarioId))
    .slice()
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const diagnostics: string[] = [];
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
    const validation = validateInteractiveViewModuleBinding(module, artifact);
    const section = resolveInteractiveViewPlanSection({ module, displayIntent, artifact, source });
    const id = `${section}-${module.moduleId}-${itemIdentity ?? artifact?.id ?? slot.artifactRef ?? slot.componentId}`;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      slot,
      module,
      artifact,
      section,
      source,
      status: validation.status,
      reason: reason ?? validation.reason,
      missingFields: validation.missingFields,
    });
  };

  for (const reference of [focusedObjectReference, ...pinnedObjectReferences].filter((item): item is ObjectReference => Boolean(item))) {
    const artifact = artifactForObjectReference(reference, session) ?? syntheticArtifactForObjectReference(reference, scenarioId);
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
    if (module) addItem(module, artifact, interactiveViewPlanSourceIds.artifactInferred);
  }

  for (const slot of seedSlots) {
    const artifact = findRenderableInteractiveArtifact(resultArtifacts, slot.artifactRef);
    const currentModule = uiModuleRegistry.find((module) => module.componentId === slot.componentId && interactiveViewModuleAcceptsArtifact(module, artifact?.type ?? slot.artifactRef));
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

  const ordered = compactInteractiveViewPlanItems(items, {
    artifacts: resultArtifacts,
    claimCount: session.claims.length,
    executionUnitCount: resultExecutionUnits.length,
    notebookEntryCount: session.notebook.length,
  }).sort(compareInteractiveViewPlanOrder);
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

function extractDisplayIntent(activeRun?: SciForgeRun): DisplayIntent | undefined {
  const candidates = [
    activeRun?.raw,
    isRecord(activeRun?.raw) ? activeRun?.raw.displayIntent : undefined,
    parseMaybeJsonObject(activeRun?.response)?.displayIntent,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const resultPresentationIntent = displayIntentFromResultPresentation(candidate.resultPresentation);
    if (resultPresentationIntent) return resultPresentationIntent;
    const primaryGoal = asString(candidate.primaryGoal) || asString(candidate.goal) || asString(candidate.title);
    if (!primaryGoal) continue;
    return {
      primaryGoal,
      requiredArtifactTypes: asStringList(candidate.requiredArtifactTypes),
      preferredModules: asStringList(candidate.preferredModules),
      fallbackAcceptable: asStringList(candidate.fallbackAcceptable),
      acceptanceCriteria: asStringList(candidate.acceptanceCriteria),
      source: 'agentserver',
    };
  }
  return undefined;
}

function displayIntentFromResultPresentation(value: unknown): DisplayIntent | undefined {
  if (!isRecord(value)) return undefined;
  const artifactActions = Array.isArray(value.artifactActions) ? value.artifactActions.filter(isRecord) : [];
  const requiredArtifactTypes = uniqueStrings(artifactActions
    .map((action) => asString(action.artifactType))
    .filter((type): type is string => Boolean(type)));
  if (!requiredArtifactTypes.length) return undefined;
  const firstAction = artifactActions.find((action) => asString(action.label));
  const answerBlocks = Array.isArray(value.answerBlocks) ? value.answerBlocks.filter(isRecord) : [];
  const firstAnswer = answerBlocks.find((block) => asString(block.text));
  return {
    primaryGoal: asString(firstAction?.label) ?? asString(firstAnswer?.text) ?? '展示 result presentation 产物',
    requiredArtifactTypes,
    preferredModules: [],
    fallbackAcceptable: [],
    acceptanceCriteria: ['render-from-result-presentation-contract'],
    source: 'agentserver',
  };
}

function resultPresentationArtifactActions(activeRun?: SciForgeRun): ResultPresentationArtifactAction[] {
  const candidates = [
    activeRun?.raw,
    isRecord(activeRun?.raw) ? activeRun?.raw.resultPresentation : undefined,
    isRecord(activeRun?.raw) && isRecord(activeRun?.raw.displayIntent) ? activeRun?.raw.displayIntent.resultPresentation : undefined,
    parseMaybeJsonObject(activeRun?.response)?.resultPresentation,
  ];
  const resultPresentation = candidates.filter(isRecord).find((candidate) => Array.isArray(candidate.artifactActions));
  const artifactActions = Array.isArray(resultPresentation?.artifactActions) ? resultPresentation.artifactActions.filter(isRecord) : [];
  return artifactActions.map((action) => ({
    ...viewCompositionFromPresentationAction(action),
    id: asString(action.id),
    label: asString(action.label),
    ref: asString(action.ref),
    artifactType: asString(action.artifactType),
    componentId: asString(action.componentId),
    moduleId: asString(action.moduleId),
    presentationKey: actionStringField(action, 'presentationKey'),
    parentArtifactRef: actionStringField(action, 'parentArtifactRef'),
    revision: actionStringOrNumberField(action, 'revision'),
    revisionRef: actionStringField(action, 'revisionRef'),
  })).filter((action) => action.ref || action.artifactType);
}

function viewCompositionFromPresentationAction(action: Record<string, unknown>): Partial<ResultPresentationArtifactAction> {
  const metadata = isRecord(action.metadata) ? action.metadata : {};
  const transformParams = isRecord(action.transformParams)
    ? action.transformParams
    : isRecord(metadata.transformParams)
      ? metadata.transformParams
      : {};
  return {
    encoding: actionRecordField(action, transformParams, 'encoding') as UIManifestSlot['encoding'],
    layout: actionRecordField(action, transformParams, 'layout') as UIManifestSlot['layout'],
    selection: actionRecordField(action, transformParams, 'selection') as UIManifestSlot['selection'],
    sync: actionRecordField(action, transformParams, 'sync') as UIManifestSlot['sync'],
    transform: actionTransformField(action, transformParams),
    compare: actionRecordField(action, transformParams, 'compare') as UIManifestSlot['compare'],
    exportProfile: actionRecordField(action, transformParams, 'exportProfile'),
    presentationKey: actionStringField(action, 'presentationKey') ?? actionStringField(metadata, 'presentationKey'),
    parentArtifactRef: actionStringField(action, 'parentArtifactRef') ?? actionStringField(metadata, 'parentArtifactRef'),
    revision: actionStringOrNumberField(action, 'revision') ?? actionStringOrNumberField(metadata, 'revision'),
    revisionRef: actionStringField(action, 'revisionRef') ?? actionStringField(metadata, 'revisionRef'),
  };
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

function actionStringField(action: Record<string, unknown>, key: string) {
  const value = asString(action[key]);
  if (value) return value;
  const metadata = isRecord(action.metadata) ? action.metadata : {};
  return asString(metadata[key]);
}

function actionStringOrNumberField(action: Record<string, unknown>, key: string): string | number | undefined {
  const value = action[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return actionStringField(action, key);
}

function actionRecordField(
  action: Record<string, unknown>,
  transformParams: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return recordField(action[key]) ?? recordField(transformParams[key]);
}

function actionTransformField(
  action: Record<string, unknown>,
  transformParams: Record<string, unknown>,
): UIManifestSlot['transform'] | undefined {
  const value = Array.isArray(action.transform) ? action.transform : transformParams.transform;
  return Array.isArray(value) ? value.filter(isViewTransform) : undefined;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isViewTransform(value: unknown): value is NonNullable<UIManifestSlot['transform']>[number] {
  if (!isRecord(value)) return false;
  return ['filter', 'sort', 'limit', 'group', 'derive'].includes(asString(value.type) ?? '');
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
    if (module && (!artifact || interactiveViewModuleAcceptsArtifact(module, artifact.type))) return module;
  }
  if (artifact && isPresentationDiagnosticArtifact(artifact.type)) {
    return findInteractiveViewModuleById(uiModuleRegistry, interactiveViewFallbackModuleIds.genericInspector);
  }
  if (artifact) return findBestInteractiveViewModuleForArtifact(uiModuleRegistry, artifact);
  if (action.artifactType && isPresentationDiagnosticArtifact(action.artifactType)) {
    return findInteractiveViewModuleById(uiModuleRegistry, interactiveViewFallbackModuleIds.genericInspector);
  }
  if (action.artifactType) return findBestInteractiveViewModuleForArtifactType(uiModuleRegistry, action.artifactType, preferredModules);
  return undefined;
}

function stripArtifactRef(value: string) {
  return value.replace(/^artifact::?/i, '');
}

function isPresentationDiagnosticArtifact(artifactType: string) {
  return /diagnostic|verification|validation|failure|repair/i.test(artifactType);
}

function artifactsForResultPresentation(session: SciForgeSession, activeRun?: SciForgeRun) {
  const runArtifacts = artifactsForRun(session, activeRun);
  if (activeRun?.status === 'failed') return runArtifacts.filter(isFailedRunDiagnosticArtifact);
  return runArtifacts;
}

function isFailedRunDiagnosticArtifact(artifact: RuntimeArtifact) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  const status = [
    artifact.type,
    metadata.status,
    metadata.validationStatus,
    data.status,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return artifact.type === 'runtime-diagnostic'
    || artifact.type === 'repair-diagnostic'
    || artifact.type === 'backend-failure'
    || artifact.type === 'contract-validation-failure'
    || /\b(?:repair-needed|failed-with-reason|failed)\b/.test(status)
    || metadata.preservedFromMalformedPayload === true;
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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
