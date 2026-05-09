import type { ArtifactPreviewAction, ObjectAction, ObjectReferenceKind, PreviewDescriptorKind, PreviewDescriptorSource, PreviewDerivativeKind, PreviewInlinePolicy, TurnAcceptanceSeverity, UserGoalType } from './domain';

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

export const previewDescriptorKinds = [
  'pdf',
  'image',
  'markdown',
  'text',
  'json',
  'table',
  'html',
  'structure',
  'office',
  'folder',
  'binary',
] as const satisfies readonly PreviewDescriptorKind[];

export const previewDescriptorSources = [
  'path',
  'dataRef',
  'artifact',
  'url',
] as const satisfies readonly PreviewDescriptorSource[];

export const previewInlinePolicies = [
  'inline',
  'stream',
  'thumbnail',
  'extract',
  'external',
  'unsupported',
] as const satisfies readonly PreviewInlinePolicy[];

export const previewDerivativeKinds = [
  'text',
  'thumb',
  'pages',
  'schema',
  'html',
  'structure-bundle',
  'metadata',
] as const satisfies readonly PreviewDerivativeKind[];

export const artifactPreviewActions = [
  'open-inline',
  'system-open',
  'copy-ref',
  'extract-text',
  'make-thumbnail',
  'select-region',
  'select-page',
  'select-rows',
  'inspect-metadata',
] as const satisfies readonly ArtifactPreviewAction[];

export const userGoalTypes = [
  'answer',
  'report',
  'analysis',
  'visualization',
  'file',
  'repair',
  'continuation',
  'workflow',
] as const satisfies readonly UserGoalType[];

export const turnAcceptanceSeverities = [
  'pass',
  'warning',
  'repairable',
  'failed',
] as const satisfies readonly TurnAcceptanceSeverity[];

export const backgroundCompletionEventTypes = [
  'background-initial-response',
  'background-stage-update',
  'background-finalization',
] as const;

export const backgroundCompletionStatuses = [
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export const runtimeContractSchemas = {
  uiModulePackage: {
    $id: 'sciforge.ui-module-package.schema.json',
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
    $id: 'sciforge.display-intent.schema.json',
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
    $id: 'sciforge.resolved-view-plan.schema.json',
    type: 'object',
    required: ['displayIntent', 'sections', 'diagnostics'],
    properties: {
      displayIntent: { $ref: 'sciforge.display-intent.schema.json' },
      sections: {
        type: 'object',
        required: ['primary', 'supporting', 'provenance', 'raw'],
      },
      diagnostics: { type: 'array', items: { type: 'string' } },
      blockedDesign: { type: 'object' },
    },
  },
  objectReference: {
    $id: 'sciforge.object-reference.schema.json',
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
  previewDescriptor: {
    $id: 'sciforge.preview-descriptor.schema.json',
    type: 'object',
    required: ['kind', 'source', 'ref', 'inlinePolicy', 'actions'],
    properties: {
      kind: { enum: previewDescriptorKinds },
      source: { enum: previewDescriptorSources },
      ref: { type: 'string' },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'number' },
      hash: { type: 'string' },
      title: { type: 'string' },
      rawUrl: { type: 'string' },
      inlinePolicy: { enum: previewInlinePolicies },
      derivatives: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'ref'],
          properties: {
            kind: { enum: previewDerivativeKinds },
            ref: { type: 'string' },
            mimeType: { type: 'string' },
            sizeBytes: { type: 'number' },
            hash: { type: 'string' },
            generatedAt: { type: 'string' },
            status: { enum: ['available', 'lazy', 'failed', 'unsupported'] },
            diagnostics: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      actions: { type: 'array', items: { enum: artifactPreviewActions } },
      diagnostics: { type: 'array', items: { type: 'string' } },
      locatorHints: { type: 'array', items: { enum: ['page', 'region', 'row-range', 'column-range', 'structure-selection', 'text-range'] } },
    },
  },
  userGoalSnapshot: {
    $id: 'sciforge.user-goal-snapshot.schema.json',
    type: 'object',
    required: ['turnId', 'rawPrompt', 'goalType', 'requiredFormats', 'requiredArtifacts', 'requiredReferences', 'uiExpectations', 'acceptanceCriteria'],
    properties: {
      turnId: { type: 'string' },
      rawPrompt: { type: 'string' },
      goalType: { enum: userGoalTypes },
      requiredFormats: { type: 'array', items: { type: 'string' } },
      requiredArtifacts: { type: 'array', items: { type: 'string' } },
      requiredReferences: { type: 'array', items: { type: 'string' } },
      freshness: { type: 'object' },
      uiExpectations: { type: 'array', items: { type: 'string' } },
      acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    },
  },
  turnAcceptance: {
    $id: 'sciforge.turn-acceptance.schema.json',
    type: 'object',
    required: ['pass', 'severity', 'checkedAt', 'failures', 'objectReferences'],
    properties: {
      pass: { type: 'boolean' },
      severity: { enum: turnAcceptanceSeverities },
      checkedAt: { type: 'string' },
      failures: { type: 'array', items: { type: 'object' } },
      objectReferences: { type: 'array', items: { $ref: 'sciforge.object-reference.schema.json' } },
      repairPrompt: { type: 'string' },
      repairAttempt: { type: 'number' },
      semantic: {
        type: 'object',
        required: ['pass', 'confidence', 'unmetCriteria', 'missingArtifacts', 'referencedEvidence'],
        properties: {
          pass: { type: 'boolean' },
          confidence: { type: 'number' },
          unmetCriteria: { type: 'array', items: { type: 'string' } },
          missingArtifacts: { type: 'array', items: { type: 'string' } },
          referencedEvidence: { type: 'array', items: { type: 'string' } },
          repairPrompt: { type: 'string' },
          backendRunRef: { type: 'string' },
        },
      },
    },
  },
  backgroundCompletionEvent: {
    $id: 'sciforge.background-completion-event.schema.json',
    type: 'object',
    required: ['contract', 'type', 'runId', 'status'],
    properties: {
      contract: { const: 'sciforge.background-completion.v1' },
      type: { enum: backgroundCompletionEventTypes },
      runId: { type: 'string' },
      stageId: { type: 'string' },
      ref: { type: 'string' },
      status: { enum: backgroundCompletionStatuses },
      prompt: { type: 'string' },
      message: { type: 'string' },
      finalResponse: { type: 'string' },
      failureReason: { type: 'string' },
      recoverActions: { type: 'array', items: { type: 'string' } },
      nextStep: { type: 'string' },
      refs: { type: 'array' },
      artifacts: { type: 'array' },
      executionUnits: { type: 'array' },
      verificationResults: { type: 'array' },
      workEvidence: { type: 'array' },
      objectReferences: { type: 'array', items: { $ref: 'sciforge.object-reference.schema.json' } },
    },
  },
} as const;

export type RuntimeContractName = keyof typeof runtimeContractSchemas;

export function validateRuntimeContract(name: RuntimeContractName, value: unknown): string[] {
  if (name === 'displayIntent') return validateDisplayIntent(value);
  if (name === 'resolvedViewPlan') return validateResolvedViewPlan(value);
  if (name === 'objectReference') return validateObjectReference(value);
  if (name === 'previewDescriptor') return validatePreviewDescriptor(value);
  if (name === 'userGoalSnapshot') return validateUserGoalSnapshot(value);
  if (name === 'turnAcceptance') return validateTurnAcceptance(value);
  if (name === 'backgroundCompletionEvent') return validateBackgroundCompletionEvent(value);
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

function validatePreviewDescriptor(value: unknown): string[] {
  const errors = requireRecord(value, 'previewDescriptor');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (!previewDescriptorKinds.includes(record.kind as PreviewDescriptorKind)) errors.push('previewDescriptor.kind is unsupported');
  if (!previewDescriptorSources.includes(record.source as PreviewDescriptorSource)) errors.push('previewDescriptor.source is unsupported');
  if (!nonEmptyString(record.ref)) errors.push('previewDescriptor.ref is required');
  if (!previewInlinePolicies.includes(record.inlinePolicy as PreviewInlinePolicy)) errors.push('previewDescriptor.inlinePolicy is unsupported');
  if (!Array.isArray(record.actions)) {
    errors.push('previewDescriptor.actions must be an array');
  } else {
    for (const action of record.actions) {
      if (!artifactPreviewActions.includes(action as ArtifactPreviewAction)) errors.push(`previewDescriptor.actions contains unsupported action: ${String(action)}`);
    }
  }
  if (record.derivatives !== undefined) {
    if (!Array.isArray(record.derivatives)) {
      errors.push('previewDescriptor.derivatives must be an array');
    } else {
      for (const [index, derivative] of record.derivatives.entries()) {
        if (!isRecord(derivative)) {
          errors.push(`previewDescriptor.derivatives.${index} must be an object`);
          continue;
        }
        if (!previewDerivativeKinds.includes(derivative.kind as PreviewDerivativeKind)) errors.push(`previewDescriptor.derivatives.${index}.kind is unsupported`);
        if (!nonEmptyString(derivative.ref)) errors.push(`previewDescriptor.derivatives.${index}.ref is required`);
      }
    }
  }
  return errors;
}

function validateUserGoalSnapshot(value: unknown): string[] {
  const errors = requireRecord(value, 'userGoalSnapshot');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (!nonEmptyString(record.turnId)) errors.push('userGoalSnapshot.turnId is required');
  if (!nonEmptyString(record.rawPrompt)) errors.push('userGoalSnapshot.rawPrompt is required');
  if (!userGoalTypes.includes(record.goalType as UserGoalType)) errors.push('userGoalSnapshot.goalType is unsupported');
  validateOptionalStringArray(record.requiredFormats, 'userGoalSnapshot.requiredFormats', errors);
  validateOptionalStringArray(record.requiredArtifacts, 'userGoalSnapshot.requiredArtifacts', errors);
  validateOptionalStringArray(record.requiredReferences, 'userGoalSnapshot.requiredReferences', errors);
  validateOptionalStringArray(record.uiExpectations, 'userGoalSnapshot.uiExpectations', errors);
  validateOptionalStringArray(record.acceptanceCriteria, 'userGoalSnapshot.acceptanceCriteria', errors);
  return errors;
}

function validateTurnAcceptance(value: unknown): string[] {
  const errors = requireRecord(value, 'turnAcceptance');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (typeof record.pass !== 'boolean') errors.push('turnAcceptance.pass must be a boolean');
  if (!turnAcceptanceSeverities.includes(record.severity as TurnAcceptanceSeverity)) errors.push('turnAcceptance.severity is unsupported');
  if (!nonEmptyString(record.checkedAt)) errors.push('turnAcceptance.checkedAt is required');
  if (!Array.isArray(record.failures)) errors.push('turnAcceptance.failures must be an array');
  if (!Array.isArray(record.objectReferences)) {
    errors.push('turnAcceptance.objectReferences must be an array');
  } else {
    record.objectReferences.forEach((reference, index) => {
      for (const error of validateObjectReference(reference)) errors.push(`turnAcceptance.objectReferences.${index}: ${error}`);
    });
  }
  if (record.semantic !== undefined) errors.push(...validateSemanticTurnAcceptance(record.semantic));
  return errors;
}

function validateBackgroundCompletionEvent(value: unknown): string[] {
  const errors = requireRecord(value, 'backgroundCompletionEvent');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (record.contract !== 'sciforge.background-completion.v1') errors.push('backgroundCompletionEvent.contract must be sciforge.background-completion.v1');
  if (!backgroundCompletionEventTypes.includes(record.type as typeof backgroundCompletionEventTypes[number])) errors.push('backgroundCompletionEvent.type is unsupported');
  if (!nonEmptyString(record.runId)) errors.push('backgroundCompletionEvent.runId is required');
  if (!backgroundCompletionStatuses.includes(record.status as typeof backgroundCompletionStatuses[number])) errors.push('backgroundCompletionEvent.status is unsupported');
  if (record.stageId !== undefined && !nonEmptyString(record.stageId)) errors.push('backgroundCompletionEvent.stageId must be a non-empty string');
  validateOptionalStringArray(record.recoverActions, 'backgroundCompletionEvent.recoverActions', errors);
  for (const field of ['refs', 'artifacts', 'executionUnits', 'verificationResults', 'workEvidence']) {
    if (record[field] !== undefined && !Array.isArray(record[field])) errors.push(`backgroundCompletionEvent.${field} must be an array`);
  }
  if (record.objectReferences !== undefined) {
    if (!Array.isArray(record.objectReferences)) {
      errors.push('backgroundCompletionEvent.objectReferences must be an array');
    } else {
      record.objectReferences.forEach((reference, index) => {
        for (const error of validateObjectReference(reference)) errors.push(`backgroundCompletionEvent.objectReferences.${index}: ${error}`);
      });
    }
  }
  return errors;
}

function validateSemanticTurnAcceptance(value: unknown): string[] {
  const errors = requireRecord(value, 'semanticTurnAcceptance');
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (typeof record.pass !== 'boolean') errors.push('semanticTurnAcceptance.pass must be a boolean');
  if (typeof record.confidence !== 'number') errors.push('semanticTurnAcceptance.confidence must be a number');
  validateOptionalStringArray(record.unmetCriteria, 'semanticTurnAcceptance.unmetCriteria', errors);
  validateOptionalStringArray(record.missingArtifacts, 'semanticTurnAcceptance.missingArtifacts', errors);
  validateOptionalStringArray(record.referencedEvidence, 'semanticTurnAcceptance.referencedEvidence', errors);
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
