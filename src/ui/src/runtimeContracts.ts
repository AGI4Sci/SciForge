import type { ObjectAction, ObjectReferenceKind } from './domain';

export const objectReferenceKinds = [
  'artifact',
  'file',
  'folder',
  'run',
  'execution-unit',
  'url',
  'scenario-package',
] as const satisfies readonly ObjectReferenceKind[];

export const objectActions = [
  'focus-right-pane',
  'inspect',
  'open-external',
  'reveal-in-folder',
  'copy-path',
  'pin',
  'compare',
] as const satisfies readonly ObjectAction[];

export const runtimeContractSchemas = {
  uiModulePackage: {
    $id: 'bioagent.ui-module-package.schema.json',
    type: 'object',
    required: ['module', 'artifactSchema', 'viewSchema', 'interactions', 'renderer', 'fixtures', 'tests', 'preview'],
    properties: {
      module: { type: 'object', required: ['moduleId', 'version', 'componentId', 'lifecycle', 'acceptsArtifactTypes'] },
      artifactSchema: { type: 'object' },
      viewSchema: { type: 'object' },
      interactions: { type: 'array' },
      renderer: { type: 'object' },
      fixtures: { type: 'array' },
      tests: { type: 'array' },
      preview: { type: 'string' },
    },
  },
  displayIntent: {
    $id: 'bioagent.display-intent.schema.json',
    type: 'object',
    required: ['primaryGoal'],
    properties: {
      primaryGoal: { type: 'string' },
      requiredArtifactTypes: { type: 'array', items: { type: 'string' } },
      preferredModules: { type: 'array', items: { type: 'string' } },
      fallbackAcceptable: { type: 'array', items: { type: 'string' } },
      acceptanceCriteria: { type: 'array', items: { type: 'string' } },
      source: { enum: ['agentserver', 'runtime-artifact', 'ui-design-studio', 'fallback-inference'] },
    },
  },
  resolvedViewPlan: {
    $id: 'bioagent.resolved-view-plan.schema.json',
    type: 'object',
    required: ['displayIntent', 'sections', 'diagnostics'],
    properties: {
      displayIntent: { $ref: 'bioagent.display-intent.schema.json' },
      sections: {
        type: 'object',
        required: ['primary', 'supporting', 'provenance', 'raw'],
      },
      diagnostics: { type: 'array', items: { type: 'string' } },
      blockedDesign: { type: 'object' },
    },
  },
  objectReference: {
    $id: 'bioagent.object-reference.schema.json',
    type: 'object',
    required: ['id', 'title', 'kind', 'ref'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      kind: { enum: objectReferenceKinds },
      ref: { type: 'string' },
      artifactType: { type: 'string' },
      runId: { type: 'string' },
      executionUnitId: { type: 'string' },
      preferredView: { type: 'string' },
      actions: { type: 'array', items: { enum: objectActions } },
      status: { enum: ['available', 'missing', 'expired', 'blocked', 'external'] },
      summary: { type: 'string' },
      provenance: { type: 'object' },
    },
  },
} as const;

export type RuntimeContractName = keyof typeof runtimeContractSchemas;

export function validateRuntimeContract(name: RuntimeContractName, value: unknown): string[] {
  if (name === 'displayIntent') return validateDisplayIntent(value);
  if (name === 'resolvedViewPlan') return validateResolvedViewPlan(value);
  if (name === 'objectReference') return validateObjectReference(value);
  return validateUIModulePackage(value);
}

export function schemaPreview(name: RuntimeContractName) {
  return JSON.stringify(runtimeContractSchemas[name], null, 2);
}

function validateDisplayIntent(value: unknown): string[] {
  const errors = requireRecord(value, 'displayIntent');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (!nonEmptyString(record.primaryGoal)) errors.push('displayIntent.primaryGoal is required');
  validateOptionalStringArray(record.requiredArtifactTypes, 'displayIntent.requiredArtifactTypes', errors);
  validateOptionalStringArray(record.preferredModules, 'displayIntent.preferredModules', errors);
  validateOptionalStringArray(record.fallbackAcceptable, 'displayIntent.fallbackAcceptable', errors);
  validateOptionalStringArray(record.acceptanceCriteria, 'displayIntent.acceptanceCriteria', errors);
  return errors;
}

function validateResolvedViewPlan(value: unknown): string[] {
  const errors = requireRecord(value, 'resolvedViewPlan');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  errors.push(...validateDisplayIntent(record.displayIntent));
  if (!isRecord(record.sections)) {
    errors.push('resolvedViewPlan.sections must be an object');
  } else {
    for (const section of ['primary', 'supporting', 'provenance', 'raw']) {
      if (!Array.isArray(record.sections[section])) errors.push(`resolvedViewPlan.sections.${section} must be an array`);
    }
  }
  if (!Array.isArray(record.diagnostics)) errors.push('resolvedViewPlan.diagnostics must be an array');
  return errors;
}

function validateObjectReference(value: unknown): string[] {
  const errors = requireRecord(value, 'objectReference');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (!nonEmptyString(record.id)) errors.push('objectReference.id is required');
  if (!nonEmptyString(record.title)) errors.push('objectReference.title is required');
  if (!objectReferenceKinds.includes(record.kind as ObjectReferenceKind)) errors.push('objectReference.kind is unsupported');
  if (!nonEmptyString(record.ref)) errors.push('objectReference.ref is required');
  if (record.actions !== undefined) {
    if (!Array.isArray(record.actions)) errors.push('objectReference.actions must be an array');
    for (const action of Array.isArray(record.actions) ? record.actions : []) {
      if (!objectActions.includes(action as ObjectAction)) errors.push(`objectReference.actions contains unsupported action: ${String(action)}`);
    }
  }
  return errors;
}

function validateUIModulePackage(value: unknown): string[] {
  const errors = requireRecord(value, 'uiModulePackage');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  for (const field of ['module', 'artifactSchema', 'viewSchema', 'renderer']) {
    if (!isRecord(record[field])) errors.push(`uiModulePackage.${field} must be an object`);
  }
  for (const field of ['interactions', 'fixtures', 'tests']) {
    if (!Array.isArray(record[field])) errors.push(`uiModulePackage.${field} must be an array`);
  }
  if (!nonEmptyString(record.preview)) errors.push('uiModulePackage.preview is required');
  if (isRecord(record.module)) {
    for (const field of ['moduleId', 'version', 'componentId', 'lifecycle']) {
      if (!nonEmptyString(record.module[field])) errors.push(`uiModulePackage.module.${field} is required`);
    }
    if (!Array.isArray(record.module.acceptsArtifactTypes)) errors.push('uiModulePackage.module.acceptsArtifactTypes must be an array');
  }
  return errors;
}

function requireRecord(value: unknown, label: string) {
  return isRecord(value) ? [] : [`${label} must be an object`];
}

function validateOptionalStringArray(value: unknown, label: string, errors: string[]) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) errors.push(`${label} must be an array of strings`);
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
