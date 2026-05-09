export type DirectAnswerResultPolicyRequest = {
  prompt: string;
  skillDomain: string;
  expectedArtifactTypes?: string[];
};

export type DirectAnswerPayloadLike = {
  message?: unknown;
  artifacts: Array<Record<string, unknown>>;
  uiManifest: Array<Record<string, unknown>>;
};

const REPORT_ARTIFACT_TYPE = 'research-report';
const REPORT_VIEW_COMPONENT = 'report-viewer';
const EXECUTION_VIEW_COMPONENT = 'execution-unit-table';
const UNKNOWN_ARTIFACT_COMPONENT = 'unknown-artifact-inspector';

const ARTIFACT_COMPONENTS: Record<string, string> = {
  [REPORT_ARTIFACT_TYPE]: REPORT_VIEW_COMPONENT,
  'paper-list': 'paper-card-list',
  'knowledge-graph': 'graph-viewer',
  'structure-summary': 'structure-viewer',
  'evidence-matrix': 'evidence-matrix',
  'notebook-timeline': 'notebook-timeline',
  'data-table': 'record-table',
};

export function directAnswerPlainTextResultPolicy(text: string, request: DirectAnswerResultPolicyRequest) {
  const artifacts = directAnswerNeedsReportArtifact(request)
    ? [directAnswerReportArtifact(text, request.skillDomain, 'agentserver-direct-text', 'plain-text')]
    : [];
  const runtimeResultRef = `${request.skillDomain}-runtime-result`;
  const reportRef = artifacts.some((artifact) => artifact.type === REPORT_ARTIFACT_TYPE) ? REPORT_ARTIFACT_TYPE : runtimeResultRef;
  return {
    artifacts,
    uiManifest: [
      { componentId: artifacts.length ? REPORT_VIEW_COMPONENT : EXECUTION_VIEW_COMPONENT, artifactRef: reportRef, priority: 1 },
      { componentId: EXECUTION_VIEW_COMPONENT, artifactRef: runtimeResultRef, priority: 2 },
    ],
  };
}

export function directAnswerNeedsReportArtifact(request: DirectAnswerResultPolicyRequest) {
  return (request.expectedArtifactTypes ?? []).includes(REPORT_ARTIFACT_TYPE)
    || /report|summary|报告|总结/.test(request.prompt.toLowerCase());
}

export function ensureDirectAnswerReportArtifactPolicy<T extends DirectAnswerPayloadLike>(
  payload: T,
  request: DirectAnswerResultPolicyRequest,
  source: string,
): T {
  if (!directAnswerNeedsReportArtifact(request)) return payload;
  const message = String(payload.message || '').trim();
  if (!message) return payload;
  const hasUsableReport = payload.artifacts.some((artifact) =>
    String(artifact.type || artifact.id || '') === REPORT_ARTIFACT_TYPE && !directAnswerArtifactNeedsRepair(artifact)
  );
  if (hasUsableReport) return payload;
  const artifacts = [
    ...payload.artifacts.filter((artifact) =>
      !(String(artifact.type || artifact.id || '') === REPORT_ARTIFACT_TYPE && directAnswerArtifactNeedsRepair(artifact))
    ),
    directAnswerReportArtifact(message, request.skillDomain, source, 'structured-answer'),
  ];
  const uiManifest = payload.uiManifest.some((slot) => String(slot.componentId || '') === REPORT_VIEW_COMPONENT)
    ? payload.uiManifest
    : [
      { componentId: REPORT_VIEW_COMPONENT, artifactRef: REPORT_ARTIFACT_TYPE, priority: 1 },
      ...payload.uiManifest.map((slot, index) => ({
        ...slot,
        priority: typeof slot.priority === 'number' ? Math.max(slot.priority, index + 2) : index + 2,
      })),
    ];
  return {
    ...payload,
    artifacts,
    uiManifest,
  };
}

export function preferredInteractiveViewComponentForArtifactType(artifactType: string) {
  return ARTIFACT_COMPONENTS[artifactType.toLowerCase()] ?? UNKNOWN_ARTIFACT_COMPONENT;
}

export function normalizeDirectAnswerUiManifest(value: unknown, artifacts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const manifest = value
      .flatMap((slot, index) => normalizeUiManifestSlot(slot, artifacts, index))
      .filter(isRecord);
    if (manifest.length) return manifest;
  }
  if (isRecord(value) && (Array.isArray(value.components) || Array.isArray(value.componentIds))) {
    const primaryArtifact = String(artifacts[0]?.id || artifacts[0]?.type || REPORT_ARTIFACT_TYPE);
    const components: unknown[] = Array.isArray(value.components) ? value.components : Array.isArray(value.componentIds) ? value.componentIds : [];
    const manifest = components
      .filter((component): component is string => typeof component === 'string' && component.trim().length > 0)
      .map((componentId, index) => ({ componentId, artifactRef: primaryArtifact, priority: index + 1 }));
    if (manifest.length) return manifest;
  }
  if (isRecord(value)) {
    const manifest = normalizeUiManifestSlot(value, artifacts, 0);
    if (manifest.length) return manifest;
  }
  if (artifacts.some((artifact) => artifact.type === REPORT_ARTIFACT_TYPE)) {
    return [{ componentId: REPORT_VIEW_COMPONENT, artifactRef: REPORT_ARTIFACT_TYPE, priority: 1 }];
  }
  return [{ componentId: EXECUTION_VIEW_COMPONENT, artifactRef: 'agentserver-runtime-result', priority: 1 }];
}

export function normalizeDirectAnswerArtifacts(value: unknown, message?: string): Array<Record<string, unknown>> {
  const artifacts = Array.isArray(value) ? value.map((artifact) => isRecord(artifact) ? artifact : undefined).filter(isRecord) : [];
  if (!artifacts.length && message) {
    return [{
      id: REPORT_ARTIFACT_TYPE,
      type: REPORT_ARTIFACT_TYPE,
      schemaVersion: '1',
      metadata: { source: 'agentserver-structured-answer' },
      data: {
        markdown: message,
        sections: [{ title: 'AgentServer Report', content: message }],
      },
    }];
  }
  return artifacts.map((artifact) => {
    const type = String(artifact.type || artifact.artifactType || artifact.id || '');
    const id = String(artifact.id || type || 'artifact');
    const normalizedArtifact = {
      ...artifact,
      id,
      type,
    };
    const data = isRecord(artifact.data) ? artifact.data : artifactDataFromLooseArtifact(normalizedArtifact);
    if (type !== REPORT_ARTIFACT_TYPE) {
      return Object.keys(data).length ? { ...normalizedArtifact, data } : normalizedArtifact;
    }
    if (isRecord(artifact.data)) return normalizedArtifact;
    const markdown = firstStringField(data, ['markdown', 'content', 'text', 'report', 'summary'])
      || message
      || String(artifact.dataRef || artifact.id || '');
    return {
      ...normalizedArtifact,
      data: {
        ...data,
        markdown,
        sections: [{ title: String(isRecord(artifact.metadata) ? artifact.metadata.title || 'AgentServer Report' : 'AgentServer Report'), content: markdown }],
      },
    };
  });
}

export function directAnswerArtifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const status = String(artifact.status || metadata.status || '').toLowerCase();
  const reason = String(artifact.failureReason || metadata.failureReason || '').toLowerCase();
  return status.includes('repair') || status.includes('fail') || /placeholder|missing|failed|repair/.test(reason);
}

function directAnswerReportArtifact(message: string, skillDomain: string, source: string, mode: 'plain-text' | 'structured-answer'): Record<string, unknown> {
  return {
    id: REPORT_ARTIFACT_TYPE,
    type: REPORT_ARTIFACT_TYPE,
    producerScenario: skillDomain,
    schemaVersion: '1',
    metadata: {
      source,
      note: mode === 'plain-text'
        ? 'AgentServer returned a natural-language answer instead of taskFiles; SciForge preserved it as a report artifact.'
        : 'AgentServer returned a direct answer with user-visible content; SciForge preserved the answer as a report artifact instead of adding a repair placeholder.',
    },
    data: mode === 'plain-text'
      ? {
        markdown: message,
        sections: [{ title: 'AgentServer Report', content: message }],
      }
      : {
        markdown: message,
        report: message,
        sections: [{ title: 'AgentServer Answer', content: message }],
      },
  };
}

function normalizeUiManifestSlot(slot: unknown, artifacts: Array<Record<string, unknown>>, index: number): Array<Record<string, unknown>> {
  if (typeof slot === 'string' && slot.trim()) {
    return [{ componentId: slot.trim(), artifactRef: firstArtifactIdOrType(artifacts), priority: index + 1 }];
  }
  if (!isRecord(slot)) return [];
  const componentId = firstStringField(slot, ['componentId', 'component', 'moduleId', 'view', 'type', 'renderer']);
  if (componentId) {
    const props = isRecord(slot.props) ? slot.props : {};
    const artifactRef = firstStringField(slot, ['artifactRef', 'artifactId', 'artifact', 'dataRef', 'ref'])
      ?? artifactRefForArtifactType(firstStringField(props, ['artifactType', 'type']), artifacts)
      ?? firstArtifactIdOrType(artifacts);
    return [{
      ...slot,
      componentId,
      artifactRef,
      priority: typeof slot.priority === 'number' ? slot.priority : index + 1,
    }];
  }
  const nestedComponents = Array.isArray(slot.components) ? slot.components : Array.isArray(slot.componentIds) ? slot.componentIds : undefined;
  if (nestedComponents) {
    return nestedComponents
      .filter((component): component is string => typeof component === 'string' && component.trim().length > 0)
      .map((nestedComponentId, nestedIndex) => ({
        componentId: nestedComponentId,
        artifactRef: firstArtifactIdOrType(artifacts),
        priority: index + nestedIndex + 1,
      }));
  }
  return [];
}

function artifactRefForArtifactType(type: string | undefined, artifacts: Array<Record<string, unknown>>) {
  if (!type) return undefined;
  const artifact = artifacts.find((candidate) => candidate.type === type || candidate.id === type);
  return firstStringField(artifact ?? {}, ['id', 'type']);
}

function firstArtifactIdOrType(artifacts: Array<Record<string, unknown>>) {
  return firstStringField(artifacts[0] ?? {}, ['id', 'type']);
}

function artifactDataFromLooseArtifact(artifact: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(artifact)) {
    if (['id', 'type', 'artifactType', 'schemaVersion', 'metadata', 'dataRef', 'visibility', 'audience', 'sensitiveDataFlags', 'exportPolicy'].includes(key)) continue;
    data[key] = value;
  }
  return data;
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return stripOuterJsonFence(value.trim());
  }
  return undefined;
}

function stripOuterJsonFence(text: string) {
  const fenced = text.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
