import type {
  DisplayIntent,
  RuntimeArtifact,
  UIManifestSlot,
  ViewPlanSection,
} from '@sciforge-ui/runtime-contract';
import type {
  PresentationDedupeScope,
  UIComponentManifest,
} from '../components';
import {
  compareInteractiveViewModulesForArtifact,
  defaultInteractiveViewAcceptanceCriteria,
  defaultInteractiveViewFallbackAcceptable,
  interactiveViewComponentAllowsMissingArtifact,
  interactiveViewComponentRank,
  interactiveViewFallbackModuleIds,
  interactiveViewFallbackBindingStatus,
  interactiveViewModuleAcceptsArtifact,
  isAuditOnlyInteractiveViewComponent,
  isEvidenceInteractiveViewComponent,
  isExecutionInteractiveViewComponent,
  isNotebookInteractiveViewComponent,
  isPrimaryInteractiveResultComponent,
  isTabularInteractiveViewComponent,
  isUnknownArtifactInspectorComponent,
} from './runtime-ui-manifest-policy';

export type InteractiveViewPlanSource =
  | 'object-focus'
  | 'display-intent'
  | 'runtime-manifest'
  | 'artifact-inferred'
  | 'default-plan'
  | 'fallback';

export type InteractiveViewBindingStatus =
  | 'bound'
  | 'missing-artifact'
  | 'missing-fields'
  | 'fallback';

export const interactiveViewPlanSourceIds = {
  objectFocus: 'object-focus',
  displayIntent: 'display-intent',
  runtimeManifest: 'runtime-manifest',
  artifactInferred: 'artifact-inferred',
  defaultPlan: 'default-plan',
  fallback: 'fallback',
} as const satisfies Record<string, InteractiveViewPlanSource>;

export type InteractiveViewPlanItem = {
  id: string;
  slot: UIManifestSlot;
  module: UIComponentManifest;
  artifact?: RuntimeArtifact;
  section: ViewPlanSection;
  source: InteractiveViewPlanSource;
  status: InteractiveViewBindingStatus;
  reason?: string;
  missingFields?: string[];
};

export type InteractiveViewPlanCompactionContext = {
  artifacts?: RuntimeArtifact[];
  claimCount?: number;
  executionUnitCount?: number;
  notebookEntryCount?: number;
};

export type InteractiveViewObjectReferenceLike = {
  preferredView?: string;
};

export type InteractiveViewBlockedDesign = {
  reason: string;
  requiredModuleCapability: string;
  resumeRunId?: string;
};

export type InteractiveViewResultSummaryPresentation = {
  badgeVariant: 'danger' | 'warning' | 'success';
  badgeLabel: string;
  boundCount: number;
  waitingCount: number;
  summaryText: string;
};

export function inferDisplayIntentFromInteractiveArtifacts(
  artifacts: RuntimeArtifact[] = [],
  modules: UIComponentManifest[] = [],
): DisplayIntent {
  const artifactTypes = Array.from(new Set(artifacts.map((artifact) => artifact.type)));
  const requiredArtifactTypes = artifactTypes.slice(0, 4);
  const preferredModules = requiredArtifactTypes
    .map((artifactType) => findBestInteractiveViewModuleForArtifactType(modules, artifactType)?.moduleId)
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

export function findInteractiveViewModuleById(modules: UIComponentManifest[], moduleId: string) {
  return modules.find((module) => module.moduleId === moduleId);
}

export function findInteractiveViewModuleForObjectReference({
  reference,
  artifact,
  modules,
}: {
  reference: InteractiveViewObjectReferenceLike;
  artifact?: RuntimeArtifact;
  modules: UIComponentManifest[];
}) {
  if (reference.preferredView) {
    const preferred = modules.find((module) => module.moduleId === reference.preferredView || module.componentId === reference.preferredView);
    if (preferred && (!artifact || interactiveViewModuleAcceptsArtifact(preferred, artifact.type))) return preferred;
  }
  if (artifact) return findBestInteractiveViewModuleForArtifact(modules, artifact);
  return findInteractiveViewModuleById(modules, interactiveViewFallbackModuleIds.genericInspector);
}

export function findBestInteractiveViewModuleForArtifact(modules: UIComponentManifest[], artifact: RuntimeArtifact) {
  return findBestInteractiveViewModuleForArtifactType(modules, artifact.type);
}

export function findBestInteractiveViewModuleForArtifactType(
  modules: UIComponentManifest[],
  artifactType: string,
  preferredModules: string[] = [],
) {
  const preferred = preferredModules
    .map((moduleId) => findInteractiveViewModuleById(modules, moduleId))
    .find((module): module is UIComponentManifest => Boolean(module && interactiveViewModuleAcceptsArtifact(module, artifactType)));
  if (preferred) return preferred;
  return modules
    .filter((module) => !isUnknownArtifactInspectorComponent(module.componentId) && interactiveViewModuleAcceptsArtifact(module, artifactType))
    .sort((left, right) => compareInteractiveViewModulesForArtifact(left, right, artifactType, preferredModules))[0]
    ?? findInteractiveViewModuleById(modules, interactiveViewFallbackModuleIds.genericInspector);
}

export function findBestInteractiveArtifactForModule(artifacts: RuntimeArtifact[], module: UIComponentManifest) {
  return artifacts.find((artifact) => interactiveViewModuleAcceptsArtifact(module, artifact.type));
}

export function findBestInteractiveArtifactForType(artifacts: RuntimeArtifact[], artifactType: string) {
  return artifacts.find((artifact) => artifact.type === artifactType || artifact.id === artifactType);
}

export function findRenderableInteractiveArtifact(artifacts: RuntimeArtifact[], artifactRef?: string) {
  if (!artifactRef) return undefined;
  return artifacts.find((artifact) => artifact.id === artifactRef || artifact.path === artifactRef || artifact.dataRef === artifactRef);
}

export function blockedInteractiveViewDesignForIntent({
  displayIntent,
  artifacts,
  items,
  modules,
  resumeRunId,
}: {
  displayIntent: DisplayIntent;
  artifacts: RuntimeArtifact[];
  items: InteractiveViewPlanItem[];
  modules: UIComponentManifest[];
  resumeRunId?: string;
}): InteractiveViewBlockedDesign | undefined {
  const requiredTypes = displayIntent.requiredArtifactTypes ?? [];
  const unsupportedType = requiredTypes.find((artifactType) => {
    const artifact = findBestInteractiveArtifactForType(artifacts, artifactType);
    if (!artifact) return false;
    const specialized = modules.find((module) => !isUnknownArtifactInspectorComponent(module.componentId) && interactiveViewModuleAcceptsArtifact(module, artifact.type));
    return !specialized;
  });
  const primaryBound = items.some((item) => item.section === 'primary' && item.status === 'bound');
  if (!unsupportedType && (primaryBound || !requiredTypes.length)) return undefined;
  if (!unsupportedType) return undefined;
  return {
    reason: `没有已发布 UI module 可作为主视图渲染 artifact type=${unsupportedType}`,
    requiredModuleCapability: `render ${unsupportedType} as primary result`,
    resumeRunId,
  };
}

export function validateInteractiveViewModuleBinding(
  module: UIComponentManifest,
  artifact?: RuntimeArtifact,
): { status: InteractiveViewBindingStatus; reason?: string; missingFields?: string[] } {
  if (!artifact && interactiveViewComponentAllowsMissingArtifact(module.componentId)) {
    return { status: 'bound' };
  }
  if (!artifact && !module.acceptsArtifactTypes.includes('*')) {
    return { status: 'missing-artifact', reason: `等待 ${module.acceptsArtifactTypes.join('/')} artifact` };
  }
  if (artifact && !interactiveViewModuleAcceptsArtifact(module, artifact.type)) {
    return { status: interactiveViewFallbackBindingStatus, reason: `${module.moduleId} 不声明消费 ${artifact.type}` };
  }
  const missingFields = (module.requiredFields ?? []).filter((field) => !interactiveViewArtifactHasField(artifact, field));
  const missingAny = (module.requiredAnyFields ?? []).filter((group) => !group.some((field) => interactiveViewArtifactHasField(artifact, field)));
  if (missingFields.length || missingAny.length) {
    return {
      status: 'missing-fields',
      reason: 'artifact 缺少模块必需字段',
      missingFields: [...missingFields, ...missingAny.map((group) => group.join('|'))],
    };
  }
  return { status: 'bound' };
}

export function interactiveViewArtifactHasField(artifact: RuntimeArtifact | undefined, field: string) {
  if (!artifact) return false;
  if (field === 'dataRef' && artifact.dataRef) return true;
  if (field in artifact) return true;
  if (isRecord(artifact.metadata) && field in artifact.metadata) return true;
  const data = artifact.data;
  if (isRecord(data) && field in data) return true;
  if (field === 'rows' && Array.isArray(data)) return true;
  return false;
}

export function resolveInteractiveViewPlanSection({
  module,
  displayIntent,
  artifact,
  source,
}: {
  module: UIComponentManifest;
  displayIntent: DisplayIntent;
  artifact?: RuntimeArtifact;
  source?: InteractiveViewPlanSource;
}): ViewPlanSection {
  if (source === 'object-focus') return 'primary';
  if (isPrimaryInteractiveResultComponent(module.componentId)) {
    if (artifact && displayIntent.requiredArtifactTypes?.includes(artifact.type)) return 'primary';
    if (displayIntent.preferredModules?.includes(module.moduleId)) return 'primary';
  }
  return module.defaultSection ?? 'supporting';
}

export function compactInteractiveViewPlanItems<T extends InteractiveViewPlanItem>(
  items: T[],
  context: InteractiveViewPlanCompactionContext = {},
): T[] {
  const strongestByArtifact = new Map<string, T>();
  const strongestByPresentationIdentity = new Map<string, T>();
  for (const item of items) {
    const artifactKey = item.artifact?.id ?? item.slot.artifactRef;
    if (artifactKey) {
      const previous = strongestByArtifact.get(artifactKey);
      if (!previous || compareInteractiveViewResultPresentationItems(item, previous) < 0) strongestByArtifact.set(artifactKey, item);
    }
    const presentationKey = interactiveViewPresentationIdentityKey(item);
    if (presentationKey) {
      const previous = strongestByPresentationIdentity.get(presentationKey);
      if (!previous || compareInteractiveViewPresentationIdentityItems(item, previous) < 0) strongestByPresentationIdentity.set(presentationKey, item);
    }
  }
  return items.filter((item) => {
    if (item.status === 'missing-artifact' && item.section !== 'primary' && item.source !== 'display-intent') return false;
    if (isExecutionInteractiveViewComponent(item.module.componentId) && !context.executionUnitCount) return false;
    if (isEvidenceInteractiveViewComponent(item.module.componentId) && !context.claimCount && !uploadedInteractiveEvidenceArtifacts(context.artifacts ?? []).length && !item.artifact) return false;
    if (isNotebookInteractiveViewComponent(item.module.componentId) && !context.notebookEntryCount && !item.artifact) return false;
    if (isUnknownArtifactInspectorComponent(item.module.componentId) && !item.artifact) return false;
    const artifactKey = item.artifact?.id ?? item.slot.artifactRef;
    const strongest = artifactKey ? strongestByArtifact.get(artifactKey) : undefined;
    if (strongest && strongest.id !== item.id && isUnknownArtifactInspectorComponent(item.module.componentId)) return false;
    if (strongest && strongest.id !== item.id && isTabularInteractiveViewComponent(item.module.componentId) && strongest.status === 'bound') return false;
    const presentationKey = interactiveViewPresentationIdentityKey(item);
    const strongestPresentation = presentationKey ? strongestByPresentationIdentity.get(presentationKey) : undefined;
    if (strongestPresentation && strongestPresentation.id !== item.id && interactiveViewPresentationDedupeEnabled(item.module)) return false;
    return true;
  });
}

export function compareInteractiveViewPlanOrder(left: InteractiveViewPlanItem, right: InteractiveViewPlanItem) {
  const sectionDelta = interactiveViewPlanSectionRank(left.section) - interactiveViewPlanSectionRank(right.section);
  if (sectionDelta) return sectionDelta;
  return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
}

export function compareInteractiveViewResultPresentationItems(left: InteractiveViewPlanItem, right: InteractiveViewPlanItem) {
  const sectionDelta = interactiveViewPlanSectionRank(left.section) - interactiveViewPlanSectionRank(right.section);
  if (sectionDelta) return sectionDelta;
  const statusDelta = interactiveViewPlanStatusRank(left.status) - interactiveViewPlanStatusRank(right.status);
  if (statusDelta) return statusDelta;
  const componentDelta = interactiveViewComponentRank(left.module.componentId) - interactiveViewComponentRank(right.module.componentId);
  if (componentDelta) return componentDelta;
  return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
}

export function isAuditOnlyInteractiveViewPlanItem(item: InteractiveViewPlanItem) {
  return isAuditOnlyInteractiveViewComponent(item.module.componentId)
    || item.section === 'provenance'
    || item.section === 'raw';
}

export function interactiveViewVisiblePresentationGroupKey(item: InteractiveViewPlanItem) {
  return `${item.section}:${item.module.componentId}`;
}

export function interactiveViewPlanSectionRank(section: ViewPlanSection) {
  if (section === 'primary') return 0;
  if (section === 'supporting') return 1;
  if (section === 'provenance') return 2;
  return 3;
}

export function interactiveViewPlanStatusRank(status: InteractiveViewBindingStatus) {
  if (status === 'bound') return 0;
  if (status === 'missing-fields') return 1;
  if (status === 'fallback') return 2;
  return 3;
}

export function interactiveViewResultSummaryPresentation({
  items,
  diagnosticCount = 0,
  runFailed = false,
}: {
  items: Array<Pick<InteractiveViewPlanItem, 'status'>>;
  diagnosticCount?: number;
  runFailed?: boolean;
}): InteractiveViewResultSummaryPresentation {
  const boundCount = items.filter((item) => item.status === 'bound').length;
  const waitingCount = items.filter(interactiveViewPlanItemWaitingForArtifactData).length;
  const hasDiagnostic = diagnosticCount > 0 || runFailed;
  return {
    badgeVariant: hasDiagnostic ? 'danger' : waitingCount ? 'warning' : 'success',
    badgeLabel: hasDiagnostic ? 'diagnostic result' : waitingCount ? 'partial result' : 'ready result',
    boundCount,
    waitingCount,
    summaryText: hasDiagnostic
      ? `${boundCount} 个诊断视图可用；未合成成功答案`
      : `${boundCount} 个结果可用${waitingCount ? `，${waitingCount} 个结果等待 artifact 或字段` : ''}`,
  };
}

function interactiveViewPlanItemWaitingForArtifactData(item: Pick<InteractiveViewPlanItem, 'status'>) {
  return item.status === 'missing-artifact' || item.status === 'missing-fields';
}

export function uploadedInteractiveEvidenceArtifacts(artifacts: RuntimeArtifact[]) {
  return artifacts.filter((artifact) => artifact.metadata?.source === 'user-upload' || /^uploaded-/.test(artifact.type));
}

function interactiveViewPresentationDedupeEnabled(module: UIComponentManifest) {
  return (module.presentation?.dedupeScope ?? 'entity') !== 'none';
}

function interactiveViewPresentationIdentityKey(item: InteractiveViewPlanItem) {
  if (!item.artifact || item.status === 'missing-artifact' || !interactiveViewPresentationDedupeEnabled(item.module)) return undefined;
  const scope = item.module.presentation?.dedupeScope ?? 'entity';
  const identity = interactiveViewArtifactPresentationIdentity(item.artifact, item.module, scope);
  return identity ? `${item.module.componentId}:${scope}:${identity}` : undefined;
}

function interactiveViewArtifactPresentationIdentity(
  artifact: RuntimeArtifact,
  module: UIComponentManifest,
  scope: PresentationDedupeScope,
) {
  const fields = module.presentation?.identityFields?.length
    ? module.presentation.identityFields
    : defaultInteractiveViewPresentationIdentityFields;
  const semanticIdentity = interactiveViewArtifactSemanticIdentity(artifact, fields, scope);
  if (semanticIdentity) return `semantic:${semanticIdentity}`;
  const provenanceIdentity = interactiveViewArtifactProvenanceIdentity(artifact);
  if (provenanceIdentity) return `provenance:${provenanceIdentity}`;
  return undefined;
}

const defaultInteractiveViewPresentationIdentityFields = [
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

function interactiveViewArtifactSemanticIdentity(
  artifact: RuntimeArtifact,
  fields: string[],
  scope: PresentationDedupeScope,
) {
  const data = artifact.data;
  const records = [
    artifact.metadata,
    interactiveViewArtifactRecordForIdentity(artifact),
    isRecord(data) ? data : undefined,
    scope === 'entity' ? firstInteractivePayloadRecordForIdentity(data) : undefined,
  ];
  for (const record of records) {
    const identity = interactiveViewIdentityFromRecord(record, fields);
    if (identity) return identity;
  }
  return undefined;
}

function interactiveViewArtifactRecordForIdentity(artifact: RuntimeArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    type: artifact.type,
    dataRef: artifact.dataRef,
    path: artifact.path,
  };
}

function firstInteractivePayloadRecordForIdentity(data: unknown): Record<string, unknown> | undefined {
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

function interactiveViewIdentityFromRecord(record: Record<string, unknown> | undefined, fields: string[]) {
  if (!record) return undefined;
  const canonicalFields = new Set(fields.map(canonicalInteractiveViewPresentationIdentityField));
  for (const field of fields) {
    const value = asString(record[field]);
    const normalized = normalizeInteractiveViewPresentationIdentity(value);
    if (normalized) return `${canonicalInteractiveViewPresentationIdentityField(field)}:${normalized}`;
  }
  for (const [field, rawValue] of Object.entries(record)) {
    const canonicalField = canonicalInteractiveViewPresentationIdentityField(field);
    if (!canonicalFields.has(canonicalField)) continue;
    const normalized = normalizeInteractiveViewPresentationIdentity(asString(rawValue));
    if (normalized) return `${canonicalField}:${normalized}`;
  }
  return undefined;
}

function canonicalInteractiveViewPresentationIdentityField(field: string) {
  return field.trim().toLowerCase().replace(/[_\-\s]+/g, '');
}

function interactiveViewArtifactProvenanceIdentity(artifact: RuntimeArtifact) {
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
  return values.map(normalizeInteractiveViewPresentationIdentity).find(Boolean);
}

function normalizeInteractiveViewPresentationIdentity(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'unknown' || normalized === 'none' || normalized === 'null' || normalized === 'undefined') return undefined;
  return normalized.replace(/\s+/g, ' ');
}

function compareInteractiveViewPresentationIdentityItems(left: InteractiveViewPlanItem, right: InteractiveViewPlanItem) {
  const statusDelta = interactiveViewPlanStatusRank(left.status) - interactiveViewPlanStatusRank(right.status);
  if (statusDelta) return statusDelta;
  const sourceDelta = interactiveViewPlanSourceRank(left.source) - interactiveViewPlanSourceRank(right.source);
  if (sourceDelta) return sourceDelta;
  const sectionDelta = interactiveViewPlanSectionRank(left.section) - interactiveViewPlanSectionRank(right.section);
  if (sectionDelta) return sectionDelta;
  return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
}

function interactiveViewPlanSourceRank(source: InteractiveViewPlanSource) {
  if (source === 'object-focus') return -1;
  if (source === 'display-intent') return 0;
  if (source === 'runtime-manifest') return 1;
  if (source === 'artifact-inferred') return 2;
  if (source === 'default-plan') return 3;
  return 4;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
