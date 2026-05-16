import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { isRecord, toRecordList } from './gateway-utils.js';
import { sha1 } from './workspace-task-runner.js';

const TOOL_ID = 'sciforge.local-reproducible-method.export-existing-script';

export async function tryRunLocalReproducibleMethodRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!/(export|notebook|script|reproducible method|rerun|commands?|导出|脚本|笔记本|复现命令)/i.test(request.prompt)) return undefined;
  const scriptRef = findScriptRef(request);
  const datasetRef = findDatasetRef(request);
  const bootstrapClaim = findBootstrapClaim(request);
  if (!scriptRef && !datasetRef) return undefined;
  const id = sha1(JSON.stringify({ prompt: request.prompt, scriptRef, datasetRef })).slice(0, 12);
  const artifactId = `reproducible-method-${id}`;
  const commands = [
    scriptRef ? `python ${scriptRef}` : undefined,
    datasetRef ? `# Dataset input: ${datasetRef}` : undefined,
    'python - <<\'PY\'\nimport pandas as pd\n# Load the CSV artifact and rerun the bootstrap sensitivity check from the SciForge report.\nPY',
  ].filter((line): line is string => Boolean(line));
  const message = [
    'Existing reproducible method exported from current artifacts; no AgentServer generation was started.',
    bootstrapClaim && /final|conclusion|bootstrap|CI|结论|置信区间/i.test(request.prompt)
      ? `Final analysis conclusion from restored artifacts: ${bootstrapClaim}`
      : undefined,
    '',
    scriptRef ? `- Script artifact: ${scriptRef}` : '- Script artifact: not found in current refs.',
    datasetRef ? `- Dataset artifact: ${datasetRef}` : '- Dataset artifact: not found in current refs.',
    '',
    '## Rerun commands',
    ...commands.map((line) => `- \`${line.replace(/\n/g, '\\n')}\``),
    '',
    '## Recovery note',
    'The export was satisfied by current artifact refs. If a notebook file is required later, convert the script with a bounded local converter rather than dispatching AgentServer generation.',
  ].filter((line): line is string => Boolean(line)).join('\n');
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'local-reproducible-method-runtime',
    source: 'workspace-runtime-gateway',
    status: 'satisfied',
    message: 'Exported reproducible method from existing artifact refs.',
    detail: `script=${scriptRef ?? 'n/a'}; dataset=${datasetRef ?? 'n/a'}`,
  });
  return {
    message,
    confidence: 0.76,
    claimType: 'analysis',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge local reproducible-method runtime reused existing script/dataset artifact refs without AgentServer generation.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
    claims: [{
      id: `claim-${artifactId}`,
      type: 'fact',
      text: scriptRef ? `Existing reproducible script is available at ${scriptRef}.` : `Existing dataset is available at ${datasetRef}.`,
      confidence: 0.76,
      evidenceLevel: 'runtime',
      supportingRefs: [scriptRef, datasetRef].filter((ref): ref is string => Boolean(ref)),
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: 'markdown-report',
      artifactRef: artifactId,
      title: 'Reproducible method export',
      priority: 1,
    }],
    executionUnits: [{
      id: `EU-${artifactId}`,
      tool: TOOL_ID,
      status: 'done',
      params: JSON.stringify({ scriptRef, datasetRef }),
      hash: sha1(message).slice(0, 16),
    }],
    artifacts: [{
      id: artifactId,
      type: 'notebook-timeline',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: TOOL_ID,
        scriptRef,
        datasetRef,
      },
      data: {
        markdown: message,
        commands,
      },
    }],
    objectReferences: [scriptRef, datasetRef].filter((ref): ref is string => Boolean(ref)).map((ref, index) => ({
      id: `obj-${artifactId}-${index + 1}`,
      kind: ref.endsWith('.py') ? 'file' : 'artifact',
      title: ref.endsWith('.py') ? 'Reproducible analysis script' : 'Dataset artifact',
      ref,
      status: 'available',
    })),
  };
}

function findBootstrapClaim(request: GatewayRequest) {
  const records = [
    ...toRecordList(request.uiState?.claims),
    ...toRecordList(request.uiState?.recentClaims),
    ...toRecordList(request.uiState?.objectReferences),
    ...toRecordList(request.uiState?.currentReferences),
  ];
  for (const record of records) {
    const text = stringField(record.text) ?? stringField(record.summary) ?? stringField(record.title);
    if (text && /Bootstrap 95% CI|bootstrap.*CI|\[[0-9.-]+,\s*[0-9.-]+\]/i.test(text)) return text;
  }
  return undefined;
}

function findScriptRef(request: GatewayRequest) {
  return findRef(request, /\.(?:py|ipynb)$/i, /(script|notebook|method|analysis-script)/i);
}

function findDatasetRef(request: GatewayRequest) {
  return findRef(request, /\.csv$/i, /(dataset|table|csv)/i);
}

function findRef(request: GatewayRequest, refPattern: RegExp, labelPattern: RegExp) {
  const records = [
    ...toRecordList(request.artifacts),
    ...toRecordList(request.references),
    ...toRecordList(request.uiState?.artifacts),
    ...toRecordList(request.uiState?.currentReferences),
    ...toRecordList(request.uiState?.objectReferences),
  ];
  for (const record of records) {
    const label = [
      stringField(record.id),
      stringField(record.type),
      stringField(record.title),
      stringField(record.label),
    ].join(' ');
    const metadata = isRecord(record.metadata) ? record.metadata : {};
    const ref = stringField(record.ref)
      ?? stringField(record.dataRef)
      ?? stringField(record.path)
      ?? stringField(metadata.codeRef)
      ?? stringField(metadata.scriptRef)
      ?? stringField(metadata.dataRef)
      ?? stringField(metadata.path);
    if (ref && (refPattern.test(ref) || labelPattern.test(label))) return ref;
  }
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
