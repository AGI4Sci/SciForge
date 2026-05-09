import { compileSlotsForScenario } from '@sciforge/scenario-core/ui-plan-compiler';
import { uiModuleRegistry, type RuntimeUIModule } from '../../uiModuleRegistry';
import type { DisplayIntent, ObjectReference, ResolvedViewPlan, RuntimeArtifact, ScenarioInstanceId, SciForgeRun, SciForgeSession, UIManifestSlot, ViewPlanSection } from '../../domain';
import type { ScenarioId } from '../../data';
import { artifactForObjectReference, syntheticArtifactForObjectReference } from '../../../../../packages/support/object-references';
import type { ResultFocusMode } from './ResultShell';
import {
  componentMatchesInteractiveViewFocus,
  compactInteractiveViewPlanItems,
  compareInteractiveViewModulesForArtifact,
  compareInteractiveViewPlanOrder,
  compareInteractiveViewResultPresentationItems,
  defaultInteractiveViewAcceptanceCriteria,
  defaultInteractiveViewFallbackAcceptable,
  interactiveViewFallbackModuleIds,
  interactiveViewModuleAcceptsArtifact,
  interactiveViewVisiblePresentationGroupKey,
  isAuditOnlyInteractiveViewPlanItem,
  isEvidenceInteractiveArtifactType,
  isEvidenceInteractiveViewComponent,
  isUnknownArtifactInspectorComponent,
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

type ViewPlanSource = InteractiveViewPlanSource;
type ViewPlanBindingStatus = InteractiveViewBindingStatus;

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
  const displayIntent = effectiveRun?.status === 'failed'
    ? inferDisplayIntentFromArtifacts(resultArtifacts)
    : extractDisplayIntent(effectiveRun) ?? inferDisplayIntentFromArtifacts(resultArtifacts);
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
    const id = `${section}-${module.moduleId}-${artifact?.id ?? slot.artifactRef ?? slot.componentId}`;
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
    const module = moduleForObjectReference(reference, artifact) ?? (artifact ? findBestModuleForArtifact(artifact) : moduleById(interactiveViewFallbackModuleIds.genericInspector));
    if (module) {
      addItem(module, artifact, 'object-focus', {
        title: reference.title,
        artifactRef: artifact?.id ?? reference.ref,
        priority: -10,
      }, reference.summary || `object reference ${reference.ref}`);
    }
  }

  for (const moduleId of displayIntent.preferredModules ?? []) {
    const module = moduleById(moduleId);
    if (!module) {
      diagnostics.push(`UI module 未发布：${moduleId}`);
      continue;
    }
    addItem(module, findBestArtifactForModule(resultArtifacts, module), 'display-intent');
  }

  for (const artifactType of displayIntent.requiredArtifactTypes ?? []) {
    const artifact = findBestArtifactForType(resultArtifacts, artifactType);
    const module = findBestModuleForArtifactType(artifact?.type ?? artifactType, displayIntent.preferredModules);
    if (module) {
      addItem(module, artifact, 'display-intent', {}, artifact ? undefined : `等待 artifact type=${artifactType}`);
    } else {
      diagnostics.push(`没有已发布 UI module 可消费 artifact type=${artifactType}`);
    }
  }

  for (const artifact of resultArtifacts.slice(0, 12)) {
    const module = findBestModuleForArtifact(artifact);
    if (module) addItem(module, artifact, 'artifact-inferred');
  }

  for (const slot of seedSlots) {
    const artifact = findRenderableArtifact(resultArtifacts, slot.artifactRef);
    const currentModule = uiModuleRegistry.find((module) => module.componentId === slot.componentId && moduleAcceptsArtifact(module, artifact?.type ?? slot.artifactRef));
    const replacementModule = artifact ? findBestModuleForArtifact(artifact) : uiModuleRegistry.find((module) => module.componentId === slot.componentId);
    const module = currentModule ?? replacementModule ?? moduleById(interactiveViewFallbackModuleIds.genericInspector);
    if (!module) continue;
    if (artifact && slot.componentId !== module.componentId) {
      diagnostics.push(`${slot.componentId} -> ${artifact.type} 已改由 ${module.componentId} 渲染，避免组件/artifact 错配。`);
    }
    addItem(module, artifact, runtimeSlots.includes(slot) ? 'runtime-manifest' : 'default-plan', {
      ...slot,
      componentId: module.componentId,
      title: slot.title ?? module.title,
      artifactRef: artifact?.id ?? slot.artifactRef,
      priority: slot.priority ?? module.priority,
    });
  }

  if (session.claims.length || resultArtifacts.some((artifact) => isEvidenceInteractiveArtifactType(artifact.type))) {
    addItem(moduleById(interactiveViewFallbackModuleIds.evidenceMatrix) ?? uiModuleRegistry[3], undefined, 'fallback');
  }
  if (session.executionUnits.length) {
    addItem(moduleById(interactiveViewFallbackModuleIds.executionProvenance) ?? uiModuleRegistry[4], undefined, 'fallback');
  }

  const ordered = compactInteractiveViewPlanItems(items, {
    artifacts: session.artifacts,
    claimCount: session.claims.length,
    executionUnitCount: session.executionUnits.length,
    notebookEntryCount: session.notebook.length,
  }).sort(compareInteractiveViewPlanOrder);
  const sections: RuntimeResolvedViewPlan['sections'] = {
    primary: [],
    supporting: [],
    provenance: [],
    raw: [],
  };
  ordered.forEach((item) => sections[item.section].push(item));

  const blockedDesign = blockedDesignForIntent(displayIntent, resultArtifacts, ordered, effectiveRun);
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

function artifactsForResultPresentation(session: SciForgeSession, activeRun?: SciForgeRun) {
  if (activeRun?.status === 'failed') return [];
  return session.artifacts;
}

function inferDisplayIntentFromArtifacts(artifacts: RuntimeArtifact[] = []): DisplayIntent {
  const artifactTypes = Array.from(new Set(artifacts.map((artifact) => artifact.type)));
  const requiredArtifactTypes = artifactTypes.slice(0, 4);
  const preferredModules = requiredArtifactTypes
    .map((artifactType) => findBestModuleForArtifactType(artifactType)?.moduleId)
    .filter((moduleId): moduleId is string => Boolean(moduleId));
  return {
    primaryGoal: '展示当前 session 的 runtime artifacts',
    requiredArtifactTypes,
    preferredModules: Array.from(new Set(preferredModules)),
    fallbackAcceptable: defaultInteractiveViewFallbackAcceptable,
    acceptanceCriteria: defaultInteractiveViewAcceptanceCriteria,
    source: 'fallback-inference',
  };
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

function moduleById(moduleId: string) {
  return uiModuleRegistry.find((module) => module.moduleId === moduleId);
}

function moduleForObjectReference(reference: ObjectReference, artifact?: RuntimeArtifact) {
  if (reference.preferredView) {
    const preferred = uiModuleRegistry.find((module) => module.moduleId === reference.preferredView || module.componentId === reference.preferredView);
    if (preferred && (!artifact || moduleAcceptsArtifact(preferred, artifact.type))) return preferred;
  }
  if (artifact) return findBestModuleForArtifact(artifact);
  return moduleById(interactiveViewFallbackModuleIds.genericInspector);
}

function moduleAcceptsArtifact(module: RuntimeUIModule, artifactType?: string) {
  return interactiveViewModuleAcceptsArtifact(module, artifactType);
}

function findBestModuleForArtifact(artifact: RuntimeArtifact) {
  return findBestModuleForArtifactType(artifact.type);
}

function findBestModuleForArtifactType(artifactType: string, preferredModules: string[] = []) {
  const preferred = preferredModules
    .map(moduleById)
    .find((module): module is RuntimeUIModule => Boolean(module && moduleAcceptsArtifact(module, artifactType)));
  if (preferred) return preferred;
  return uiModuleRegistry
    .filter((module) => !isUnknownArtifactInspectorComponent(module.componentId) && moduleAcceptsArtifact(module, artifactType))
    .sort((left, right) => compareInteractiveViewModulesForArtifact(left, right, artifactType, preferredModules))[0]
    ?? moduleById(interactiveViewFallbackModuleIds.genericInspector);
}

function findBestArtifactForModule(artifacts: RuntimeArtifact[], module: RuntimeUIModule) {
  return artifacts.find((artifact) => moduleAcceptsArtifact(module, artifact.type));
}

function findBestArtifactForType(artifacts: RuntimeArtifact[], artifactType: string) {
  return artifacts.find((artifact) => artifact.type === artifactType || artifact.id === artifactType);
}

function findRenderableArtifact(artifacts: RuntimeArtifact[], artifactRef?: string) {
  if (!artifactRef) return undefined;
  return artifacts.find((artifact) => artifact.id === artifactRef || artifact.path === artifactRef || artifact.dataRef === artifactRef);
}

function blockedDesignForIntent(
  displayIntent: DisplayIntent,
  artifacts: RuntimeArtifact[],
  items: ResolvedViewPlanItem[],
  activeRun?: SciForgeRun,
) {
  const requiredTypes = displayIntent.requiredArtifactTypes ?? [];
  const unsupportedType = requiredTypes.find((artifactType) => {
    const artifact = findBestArtifactForType(artifacts, artifactType);
    if (!artifact) return false;
    const specialized = uiModuleRegistry.find((module) => !isUnknownArtifactInspectorComponent(module.componentId) && moduleAcceptsArtifact(module, artifact.type));
    return !specialized;
  });
  const primaryBound = items.some((item) => item.section === 'primary' && item.status === 'bound');
  if (!unsupportedType && (primaryBound || !requiredTypes.length)) return undefined;
  if (unsupportedType) {
    return {
      reason: `没有已发布 UI module 可作为主视图渲染 artifact type=${unsupportedType}`,
      requiredModuleCapability: `render ${unsupportedType} as primary result`,
      resumeRunId: activeRun?.id,
    };
  }
  return undefined;
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
  const sorted = [...items].sort(compareInteractiveViewResultPresentationItems);
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
