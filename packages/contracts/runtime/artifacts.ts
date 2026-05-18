import type { ScenarioInstanceId, ScenarioPackageRef } from './app';
import type { PreviewDescriptor } from './preview';

export type RuntimeArtifactVisibility = 'private-draft' | 'team-visible' | 'project-record' | 'restricted-sensitive';
export type RuntimeArtifactExportPolicy = 'allowed' | 'restricted' | 'blocked';
export type RuntimeArtifactDerivationVerificationStatus = 'verified' | 'unverified' | 'needs-review' | 'failed';
export type ArtifactDeliveryRole = 'primary-deliverable' | 'supporting-evidence' | 'audit' | 'diagnostic' | 'internal';
export type ArtifactDeliveryContentShape = 'raw-file' | 'json-envelope' | 'binary-ref' | 'external-ref';
export type ArtifactDeliveryPreviewPolicy = 'inline' | 'open-system' | 'audit-only' | 'unsupported';

export interface ArtifactDelivery {
  contractId: 'sciforge.artifact-delivery.v1';
  ref: string;
  role: ArtifactDeliveryRole;
  declaredMediaType: string;
  declaredExtension: string;
  contentShape: ArtifactDeliveryContentShape;
  readableRef?: string;
  rawRef?: string;
  previewPolicy: ArtifactDeliveryPreviewPolicy;
}

export interface RuntimeArtifactDerivation {
  schemaVersion: 'sciforge.artifact-derivation.v1';
  kind: 'summary' | 'translation' | 'glossary' | 'correction' | 'rewrite' | string;
  parentArtifactRef?: string;
  sourceRefs: string[];
  sourceLanguage?: string;
  targetLanguage?: string;
  verificationStatus?: RuntimeArtifactDerivationVerificationStatus;
}

export interface RuntimeArtifactMetadata extends Record<string, unknown> {
  language?: string;
  role?: string;
  derivation?: RuntimeArtifactDerivation;
}

export interface RuntimeArtifact {
  id: string;
  type: string;
  producerScenario: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  schemaVersion: string;
  metadata?: RuntimeArtifactMetadata;
  data?: unknown;
  dataRef?: string;
  path?: string;
  delivery?: ArtifactDelivery;
  previewDescriptor?: PreviewDescriptor;
  visibility?: RuntimeArtifactVisibility;
  audience?: string[];
  sensitiveDataFlags?: string[];
  exportPolicy?: RuntimeArtifactExportPolicy;
}

export type ArtifactDeliveryVisibilityInput = Pick<RuntimeArtifact, 'data' | 'dataRef' | 'path' | 'delivery'>;
export type ArtifactDeliveryPreviewNoticeInput = Pick<RuntimeArtifact, 'dataRef' | 'path' | 'delivery'>;

export function runtimeArtifactRef(id: string) {
  return `artifact:${id}`;
}

export function runtimeArtifactDataRefSource(id: string) {
  return `${runtimeArtifactRef(id)}:dataRef`;
}

export function runtimeArtifactPathRefSource(id: string) {
  return `${runtimeArtifactRef(id)}:path`;
}

export function artifactHasUserFacingDelivery(artifact: ArtifactDeliveryVisibilityInput | undefined): boolean {
  const delivery = artifact?.delivery;
  return artifactDeliveryTargetsUserFacingSurface(artifact)
    && delivery?.contentShape !== 'json-envelope';
}

export function artifactDeliveryPreviewNotice(artifact: ArtifactDeliveryPreviewNoticeInput | undefined): { subtitle: string; detail: string; openRef?: string } | undefined {
  const delivery = artifact?.delivery;
  if (!artifact || !delivery) return undefined;
  if (delivery.previewPolicy !== 'open-system' && delivery.previewPolicy !== 'unsupported') return undefined;
  const openRef = delivery.readableRef ?? artifact.dataRef ?? artifact.path;
  return {
    subtitle: delivery.previewPolicy === 'open-system' ? '当前格式交给系统默认程序打开' : '当前 UI 暂不支持内联预览',
    detail: delivery.previewPolicy === 'open-system'
      ? '这个 artifact 已通过 ArtifactDelivery contract 标记为本地文件交付物；SciForge 保留引用和审计信息，完整内容可用系统默认程序打开。'
      : '这个 artifact 的格式与当前已发布 UI component 不匹配；主内容不会被当作 JSON fallback 展示，原始材料已保留用于审计。',
    openRef,
  };
}

export function validateArtifactDeliveryContract(artifact: Pick<RuntimeArtifact, 'id' | 'data' | 'dataRef' | 'path' | 'delivery'>): string[] {
  const delivery = artifact.delivery;
  if (!delivery) return [];
  const errors: string[] = [];
  if (delivery.contractId !== 'sciforge.artifact-delivery.v1') errors.push('delivery.contractId must be sciforge.artifact-delivery.v1');
  if (!delivery.ref) errors.push('delivery.ref is required');
  if (!artifactDeliveryRoles.includes(delivery.role)) errors.push('delivery.role is unsupported');
  if (!delivery.declaredMediaType) errors.push('delivery.declaredMediaType is required');
  if (!delivery.declaredExtension) errors.push('delivery.declaredExtension is required');
  if (!artifactDeliveryContentShapes.includes(delivery.contentShape)) errors.push('delivery.contentShape is unsupported');
  if (!artifactDeliveryPreviewPolicies.includes(delivery.previewPolicy)) errors.push('delivery.previewPolicy is unsupported');
  if (artifactDeliveryTargetsUserFacingSurface(artifact) && delivery.contentShape === 'json-envelope') {
    errors.push('user-facing delivery cannot point at a json-envelope');
  }
  if (delivery.previewPolicy === 'inline' && !artifactDeliveryHasReadableTarget(artifact)) {
    errors.push('inline delivery requires readableRef, data, dataRef, or path');
  }
  return errors;
}

function artifactDeliveryTargetsUserFacingSurface(artifact: ArtifactDeliveryVisibilityInput | undefined): boolean {
  const delivery = artifact?.delivery;
  if (!delivery) return false;
  if (delivery.role !== 'primary-deliverable' && delivery.role !== 'supporting-evidence') return false;
  if (delivery.previewPolicy !== 'inline' && delivery.previewPolicy !== 'open-system') return false;
  return artifactDeliveryHasReadableTarget(artifact);
}

function artifactDeliveryHasReadableTarget(artifact: ArtifactDeliveryVisibilityInput | undefined): boolean {
  const delivery = artifact?.delivery;
  return Boolean(
    nonEmptyString(delivery?.readableRef)
      || artifact?.data !== undefined
      || nonEmptyString(artifact?.dataRef)
      || nonEmptyString(artifact?.path),
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const artifactDeliveryRoles = [
  'primary-deliverable',
  'supporting-evidence',
  'audit',
  'diagnostic',
  'internal',
] as const satisfies readonly ArtifactDeliveryRole[];

const artifactDeliveryContentShapes = [
  'raw-file',
  'json-envelope',
  'binary-ref',
  'external-ref',
] as const satisfies readonly ArtifactDeliveryContentShape[];

const artifactDeliveryPreviewPolicies = [
  'inline',
  'open-system',
  'audit-only',
  'unsupported',
] as const satisfies readonly ArtifactDeliveryPreviewPolicy[];
