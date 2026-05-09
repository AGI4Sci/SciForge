import { compileSlotsForScenario } from '../../scenarioCompiler/uiPlanCompiler';
import { uiModuleRegistry, type PresentationDedupeScope, type RuntimeUIModule } from '../../uiModuleRegistry';
import type { DisplayIntent, ObjectReference, ResolvedViewPlan, RuntimeArtifact, ScenarioInstanceId, SciForgeRun, SciForgeSession, UIManifestSlot, ViewPlanSection } from '../../domain';
import type { ScenarioId } from '../../data';
import { artifactForObjectReference, syntheticArtifactForObjectReference } from '../../../../../packages/support/object-references';
import type { ResultFocusMode } from './ResultShell';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

type ViewPlanSource = 'object-focus' | 'display-intent' | 'runtime-manifest' | 'artifact-inferred' | 'default-plan' | 'fallback';
type ViewPlanBindingStatus = 'bound' | 'missing-artifact' | 'missing-fields' | 'fallback';

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
    const validation = validateModuleBinding(module, artifact);
    const section = source === 'object-focus' ? 'primary' : sectionForModule(module, displayIntent, artifact);
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
    const module = moduleForObjectReference(reference, artifact) ?? (artifact ? findBestModuleForArtifact(artifact) : moduleById('generic-artifact-inspector'));
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
    const module = currentModule ?? replacementModule ?? moduleById('generic-artifact-inspector');
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

  if (session.claims.length || resultArtifacts.some((artifact) => artifact.type === 'evidence-matrix')) {
    addItem(moduleById('evidence-matrix-panel') ?? uiModuleRegistry[3], undefined, 'fallback');
  }
  if (session.executionUnits.length) {
    addItem(moduleById('execution-provenance-table') ?? uiModuleRegistry[4], undefined, 'fallback');
  }

  const ordered = compactViewPlanItems(items, session).sort((left, right) => {
    const sectionDelta = sectionRank(left.section) - sectionRank(right.section);
    if (sectionDelta) return sectionDelta;
    return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
  });
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
    fallbackAcceptable: ['generic-data-table', 'generic-artifact-inspector'],
    acceptanceCriteria: ['primary result visible', 'artifact binding validated', 'fallback explains missing fields'],
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
  return moduleById('generic-artifact-inspector');
}

function moduleAcceptsArtifact(module: RuntimeUIModule, artifactType?: string) {
  if (!artifactType) return module.acceptsArtifactTypes.includes('*');
  return module.acceptsArtifactTypes.includes('*') || module.acceptsArtifactTypes.includes(artifactType);
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
    .filter((module) => module.componentId !== 'unknown-artifact-inspector' && moduleAcceptsArtifact(module, artifactType))
    .sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99))[0]
    ?? moduleById('generic-artifact-inspector');
}

function findBestArtifactForModule(artifacts: RuntimeArtifact[], module: RuntimeUIModule) {
  return artifacts.find((artifact) => moduleAcceptsArtifact(module, artifact.type));
}

function findBestArtifactForType(artifacts: RuntimeArtifact[], artifactType: string) {
  return artifacts.find((artifact) => artifact.type === artifactType || artifact.id === artifactType)
    ?? artifacts.find((artifact) => artifactTypeMatches(artifact.type, artifactType));
}

function findRenderableArtifact(artifacts: RuntimeArtifact[], artifactRef?: string) {
  if (!artifactRef) return undefined;
  return artifacts.find((artifact) => artifact.id === artifactRef || artifact.path === artifactRef || artifact.dataRef === artifactRef);
}

function artifactTypeMatches(actualType: string, requestedType: string) {
  if (actualType === requestedType) return true;
  if (isStructureArtifactType(actualType) && isStructureArtifactType(requestedType)) return true;
  return false;
}

function isStructureArtifactType(type: string) {
  return /structure|pdb|protein|molecule|mmcif|cif|3d/i.test(type);
}

function validateModuleBinding(module: RuntimeUIModule, artifact?: RuntimeArtifact): { status: ViewPlanBindingStatus; reason?: string; missingFields?: string[] } {
  if (!artifact && ['evidence-matrix', 'execution-unit-table', 'notebook-timeline'].includes(module.componentId)) {
    return { status: 'bound' };
  }
  if (!artifact && !module.acceptsArtifactTypes.includes('*')) {
    return { status: 'missing-artifact', reason: `等待 ${module.acceptsArtifactTypes.join('/')} artifact` };
  }
  if (artifact && !moduleAcceptsArtifact(module, artifact.type)) {
    return { status: 'fallback', reason: `${module.moduleId} 不声明消费 ${artifact.type}` };
  }
  const missingFields = (module.requiredFields ?? []).filter((field) => !artifactHasField(artifact, field));
  const missingAny = (module.requiredAnyFields ?? []).filter((group) => !group.some((field) => artifactHasField(artifact, field)));
  if (missingFields.length || missingAny.length) {
    return {
      status: 'missing-fields',
      reason: 'artifact 缺少模块必需字段',
      missingFields: [...missingFields, ...missingAny.map((group) => group.join('|'))],
    };
  }
  return { status: 'bound' };
}

function artifactHasField(artifact: RuntimeArtifact | undefined, field: string) {
  if (!artifact) return false;
  if (field === 'dataRef' && artifact.dataRef) return true;
  if (field in artifact) return true;
  if (isRecord(artifact.metadata) && field in artifact.metadata) return true;
  const data = artifact.data;
  if (isRecord(data) && field in data) return true;
  if (field === 'rows' && Array.isArray(data)) return true;
  return false;
}

function uploadedEvidenceArtifacts(artifacts: RuntimeArtifact[]) {
  return artifacts.filter((artifact) => artifact.metadata?.source === 'user-upload' || /^uploaded-/.test(artifact.type));
}

function sectionForModule(module: RuntimeUIModule, displayIntent: DisplayIntent, artifact?: RuntimeArtifact): ViewPlanSection {
  if (isPrimaryResultModule(module)) {
    if (artifact && displayIntent.requiredArtifactTypes?.includes(artifact.type)) return 'primary';
    if (displayIntent.preferredModules?.includes(module.moduleId)) return 'primary';
  }
  return module.defaultSection ?? 'supporting';
}

function isPrimaryResultModule(module: RuntimeUIModule) {
  return [
    'report-viewer',
    'structure-viewer',
    'molecule-viewer',
    'point-set-viewer',
    'volcano-plot',
    'umap-viewer',
    'matrix-viewer',
    'heatmap-viewer',
    'graph-viewer',
    'network-graph',
  ].includes(module.componentId);
}

function compactViewPlanItems(items: ResolvedViewPlanItem[], session: SciForgeSession) {
  const strongestByArtifact = new Map<string, ResolvedViewPlanItem>();
  const strongestByPresentationIdentity = new Map<string, ResolvedViewPlanItem>();
  for (const item of items) {
    const artifactKey = item.artifact?.id ?? item.slot.artifactRef;
    if (artifactKey) {
      const previous = strongestByArtifact.get(artifactKey);
      if (!previous || resultPresentationRank(item, previous) < 0) strongestByArtifact.set(artifactKey, item);
    }
    const presentationKey = presentationIdentityKey(item);
    if (presentationKey) {
      const previous = strongestByPresentationIdentity.get(presentationKey);
      if (!previous || presentationIdentityRank(item, previous) < 0) strongestByPresentationIdentity.set(presentationKey, item);
    }
  }
  return items.filter((item) => {
    if (item.status === 'missing-artifact' && item.section !== 'primary' && item.source !== 'display-intent') return false;
    if (item.module.componentId === 'execution-unit-table' && !session.executionUnits.length) return false;
    if (item.module.componentId === 'evidence-matrix' && !session.claims.length && !uploadedEvidenceArtifacts(session.artifacts).length && !item.artifact) return false;
    if (item.module.componentId === 'notebook-timeline' && !session.notebook.length && !item.artifact) return false;
    if (item.module.componentId === 'unknown-artifact-inspector' && !item.artifact) return false;
    const artifactKey = item.artifact?.id ?? item.slot.artifactRef;
    const strongest = artifactKey ? strongestByArtifact.get(artifactKey) : undefined;
    if (strongest && strongest.id !== item.id && item.module.componentId === 'unknown-artifact-inspector') return false;
    if (strongest && strongest.id !== item.id && (item.module.componentId === 'record-table' || item.module.componentId === 'data-table') && strongest.status === 'bound') return false;
    const presentationKey = presentationIdentityKey(item);
    const strongestPresentation = presentationKey ? strongestByPresentationIdentity.get(presentationKey) : undefined;
    if (strongestPresentation && strongestPresentation.id !== item.id && isPresentationDedupeEnabled(item.module)) return false;
    return true;
  });
}

function isPresentationDedupeEnabled(module: RuntimeUIModule) {
  return (module.presentation?.dedupeScope ?? 'entity') !== 'none';
}

function presentationIdentityKey(item: ResolvedViewPlanItem) {
  if (!item.artifact || item.status === 'missing-artifact' || !isPresentationDedupeEnabled(item.module)) return undefined;
  const scope = item.module.presentation?.dedupeScope ?? 'entity';
  const identity = artifactPresentationIdentity(item.artifact, item.module, scope);
  return identity ? `${item.module.componentId}:${scope}:${identity}` : undefined;
}

function artifactPresentationIdentity(
  artifact: RuntimeArtifact,
  module: RuntimeUIModule,
  scope: PresentationDedupeScope,
) {
  const fields = module.presentation?.identityFields?.length
    ? module.presentation.identityFields
    : defaultPresentationIdentityFields;
  const semanticIdentity = artifactSemanticIdentity(artifact, fields, scope);
  if (semanticIdentity) return `semantic:${semanticIdentity}`;
  const provenanceIdentity = artifactProvenanceIdentity(artifact);
  if (provenanceIdentity) return `provenance:${provenanceIdentity}`;
  return undefined;
}

const defaultPresentationIdentityFields = [
  'presentationKey',
  'resultKey',
  'displayKey',
  'semanticKey',
  'entityKey',
  'entityId',
  'entity_id',
  'targetId',
  'target_id',
  'subjectId',
  'subject_id',
  'accession',
  'accessionId',
  'accession_id',
  'gene',
  'symbol',
  'compoundId',
  'compound_id',
  'datasetId',
  'dataset_id',
  'reportId',
  'report_id',
  'documentId',
  'document_id',
  'paperId',
  'paper_id',
  'doi',
  'url',
  'dataRef',
  'outputRef',
  'resultRef',
];

function artifactSemanticIdentity(
  artifact: RuntimeArtifact,
  fields: string[],
  scope: PresentationDedupeScope,
) {
  const data = artifact.data;
  const records = [
    artifact.metadata,
    artifactRecordForIdentity(artifact),
    isRecord(data) ? data : undefined,
    scope === 'entity' ? firstPayloadRecordForIdentity(data) : undefined,
  ];
  for (const record of records) {
    const identity = identityFromRecord(record, fields);
    if (identity) return identity;
  }
  return undefined;
}

function artifactRecordForIdentity(artifact: RuntimeArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    type: artifact.type,
    dataRef: artifact.dataRef,
    path: artifact.path,
  };
}

function firstPayloadRecordForIdentity(data: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(data)) return toRecordList(data)[0];
  if (!isRecord(data)) return undefined;
  for (const key of ['selected', 'primary', 'item', 'record', 'data', 'structures', 'rows', 'items', 'results', 'records']) {
    const value = data[key];
    if (isRecord(value)) return value;
    const first = toRecordList(value)[0];
    if (first) return first;
  }
  return undefined;
}

function identityFromRecord(record: Record<string, unknown> | undefined, fields: string[]) {
  if (!record) return undefined;
  const canonicalFields = new Set(fields.map(canonicalPresentationIdentityField));
  for (const field of fields) {
    const value = asString(record[field]);
    const normalized = normalizePresentationIdentity(value);
    if (normalized) return `${canonicalPresentationIdentityField(field)}:${normalized}`;
  }
  for (const [field, rawValue] of Object.entries(record)) {
    const canonicalField = canonicalPresentationIdentityField(field);
    if (!canonicalFields.has(canonicalField)) continue;
    const normalized = normalizePresentationIdentity(asString(rawValue));
    if (normalized) return `${canonicalField}:${normalized}`;
  }
  return undefined;
}

function canonicalPresentationIdentityField(field: string) {
  return field.trim().toLowerCase().replace(/[_\-\s]+/g, '');
}

function artifactProvenanceIdentity(artifact: RuntimeArtifact) {
  const metadata = artifact.metadata ?? {};
  const values = [
    artifact.dataRef,
    artifact.path,
    asString(metadata.outputRef),
    asString(metadata.resultRef),
    asString(metadata.dataRef),
    asString(metadata.path),
    asString(metadata.runId),
    asString(metadata.agentServerRunId),
    asString(metadata.provenanceRef),
  ];
  return values.map(normalizePresentationIdentity).find(Boolean);
}

function normalizePresentationIdentity(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'unknown' || normalized === 'none' || normalized === 'null' || normalized === 'undefined') return undefined;
  return normalized.replace(/\s+/g, ' ');
}

function presentationIdentityRank(left: ResolvedViewPlanItem, right: ResolvedViewPlanItem) {
  const statusDelta = resultStatusRank(left.status) - resultStatusRank(right.status);
  if (statusDelta) return statusDelta;
  const payloadDelta = artifactPresentationPayloadRank(left.artifact) - artifactPresentationPayloadRank(right.artifact);
  if (payloadDelta) return payloadDelta;
  const sourceDelta = viewPlanSourceRank(left.source) - viewPlanSourceRank(right.source);
  if (sourceDelta) return sourceDelta;
  const sectionDelta = sectionRank(left.section) - sectionRank(right.section);
  if (sectionDelta) return sectionDelta;
  return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
}

function artifactPresentationPayloadRank(artifact?: RuntimeArtifact) {
  if (!artifact) return 50;
  const type = artifact.type.toLowerCase();
  if (/(interactive|viewer|html|3d|image|figure|plot|chart|report|document|markdown)/i.test(type)) return 0;
  if (/(file|coordinate|matrix|graph|network|table|dataset|dataframe|csv|tsv|json)/i.test(type)) return 1;
  if (/(summary|profile|annotation|metadata)/i.test(type)) return 2;
  if (/(list|collection|index|search-result)/i.test(type)) return 6;
  if (artifact.dataRef || artifact.path) return 3;
  return 8;
}

function viewPlanSourceRank(source: ViewPlanSource) {
  if (source === 'object-focus') return -1;
  if (source === 'display-intent') return 0;
  if (source === 'runtime-manifest') return 1;
  if (source === 'artifact-inferred') return 2;
  if (source === 'default-plan') return 3;
  return 4;
}

function sectionRank(section: ViewPlanSection) {
  if (section === 'primary') return 0;
  if (section === 'supporting') return 1;
  if (section === 'provenance') return 2;
  return 3;
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
    const specialized = uiModuleRegistry.find((module) => module.componentId !== 'unknown-artifact-inspector' && moduleAcceptsArtifact(module, artifact.type));
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
  if (focusMode === 'all') return true;
  if (focusMode === 'evidence') return item.module.componentId === 'evidence-matrix' || item.artifact?.type === 'evidence-matrix';
  if (focusMode === 'execution') return item.module.componentId === 'execution-unit-table' || item.section === 'provenance';
  return [
    'structure-viewer',
    'molecule-viewer',
    'point-set-viewer',
    'volcano-plot',
    'umap-viewer',
    'matrix-viewer',
    'heatmap-viewer',
    'graph-viewer',
    'network-graph',
    'report-viewer',
  ].includes(item.module.componentId);
}



export function viewPlanSectionLabel(section: ViewPlanSection) {
  if (section === 'primary') return '核心结果';
  if (section === 'supporting') return '支撑证据';
  if (section === 'provenance') return '执行记录';
  return '原始数据 / fallback';
}

export function selectDefaultResultItems(items: ResolvedViewPlanItem[], focusMode: ResultFocusMode) {
  const sorted = [...items].sort(resultPresentationRank);
  const focused = sorted.filter((item) => item.source === 'object-focus');
  if (focused.length && focusMode === 'all') {
    const visibleItems: ResolvedViewPlanItem[] = [];
    pushUniqueVisibleItems(visibleItems, focused, 2);
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    return {
      visibleItems,
      deferredItems: sorted.filter((item) => !visibleIds.has(item.id) && !isAuditOnlyResultItem(item)),
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
  const userFacing = sorted.filter((item) => !isAuditOnlyResultItem(item));
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

function isAuditOnlyResultItem(item: ResolvedViewPlanItem) {
  return item.module.componentId === 'evidence-matrix'
    || item.module.componentId === 'execution-unit-table'
    || item.module.componentId === 'notebook-timeline'
    || item.module.componentId === 'unknown-artifact-inspector'
    || item.section === 'provenance'
    || item.section === 'raw';
}

function pushUniqueVisibleItems(target: ResolvedViewPlanItem[], candidates: ResolvedViewPlanItem[], limit: number) {
  const visibleKeys = new Set(target.map(visiblePresentationGroupKey));
  for (const item of candidates) {
    if (target.length >= limit) break;
    const key = visiblePresentationGroupKey(item);
    if (visibleKeys.has(key)) continue;
    visibleKeys.add(key);
    target.push(item);
  }
}

function visiblePresentationGroupKey(item: ResolvedViewPlanItem) {
  return `${item.section}:${item.module.componentId}`;
}

function resultPresentationRank(left: ResolvedViewPlanItem, right: ResolvedViewPlanItem) {
  const sectionDelta = sectionRank(left.section) - sectionRank(right.section);
  if (sectionDelta) return sectionDelta;
  const statusDelta = resultStatusRank(left.status) - resultStatusRank(right.status);
  if (statusDelta) return statusDelta;
  const componentDelta = resultComponentRank(left.module.componentId) - resultComponentRank(right.module.componentId);
  if (componentDelta) return componentDelta;
  return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
}

function resultStatusRank(status: ResolvedViewPlanItem['status']) {
  if (status === 'bound') return 0;
  if (status === 'missing-fields') return 1;
  if (status === 'fallback') return 2;
  return 3;
}

function resultComponentRank(componentId: string) {
  const order = [
    'report-viewer',
    'structure-viewer',
    'molecule-viewer',
    'evidence-matrix',
    'paper-card-list',
    'graph-viewer',
    'network-graph',
    'point-set-viewer',
    'matrix-viewer',
    'record-table',
    'data-table',
    'execution-unit-table',
    'notebook-timeline',
    'unknown-artifact-inspector',
  ];
  const index = order.indexOf(componentId);
  return index === -1 ? 99 : index;
}
