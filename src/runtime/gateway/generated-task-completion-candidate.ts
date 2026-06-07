import { extname, relative, resolve, sep } from 'node:path';

import type { ToolPayload } from '../runtime-types.js';
import { isRecord, uniqueStrings } from '../gateway-utils.js';
import type { WorkEvidence } from './work-evidence-types.js';

export interface AgentServerCompletionCandidate {
  schemaVersion: 'sciforge.completion-candidate.v1';
  source: 'agentserver-side-effect-work-evidence';
  status: 'unverified';
  summary: string;
  artifactRefs: string[];
  auditRefs: string[];
  recoverActions: string[];
  createdAt: string;
}

export function completionCandidateFromAgentServerWorkEvidence(params: {
  workspace: string;
  workEvidence?: WorkEvidence[];
  failureKind?: string;
  now?: Date;
}): AgentServerCompletionCandidate | undefined {
  const refs = uniqueStrings((params.workEvidence ?? [])
    .flatMap((entry) => candidateRefsFromWorkEvidence(params.workspace, entry)))
    .slice(0, 8);
  if (!refs.length) return undefined;
  return {
    schemaVersion: 'sciforge.completion-candidate.v1',
    source: 'agentserver-side-effect-work-evidence',
    status: 'unverified',
    summary: `AgentServer failed before a terminal result, but wrote ${refs.length} workspace file(s) that may contain useful partial work. Treat them as unverified candidates until rerun or inspected.`,
    artifactRefs: refs.map((ref) => `artifact:${artifactIdForWorkspaceRef(ref)}`),
    auditRefs: refs,
    recoverActions: [
      'Inspect and verify the candidate files before using them as the final answer.',
      'Rerun the relevant tests or commands against the candidate files.',
      'Continue from the candidate refs with a bounded repair request instead of repeating the full failed generation.',
    ],
    createdAt: (params.now ?? new Date()).toISOString(),
  };
}

export function attachAgentServerCompletionCandidateArtifacts(params: {
  payload: ToolPayload;
  workspace: string;
  workEvidence?: WorkEvidence[];
  failureKind?: string;
  now?: Date;
}): ToolPayload {
  const candidate = completionCandidateFromAgentServerWorkEvidence(params);
  if (!candidate) return params.payload;
  const artifacts = candidate.auditRefs.map((ref) => candidateArtifactForWorkspaceRef(ref));
  return {
    ...params.payload,
    displayIntent: {
      ...(params.payload.displayIntent ?? {}),
      completionCandidate: candidate,
    },
    artifacts: [
      ...params.payload.artifacts,
      ...artifacts.filter((artifact) => !params.payload.artifacts.some((existing) => existing.id === artifact.id)),
    ],
    objectReferences: [
      ...(params.payload.objectReferences ?? []),
      ...candidate.artifactRefs.map((ref) => ({
        id: ref.replace(/^artifact:/, ''),
        kind: 'artifact',
        ref,
        status: 'unverified',
        title: ref.replace(/^artifact:/, ''),
      })),
    ],
  };
}

function candidateRefsFromWorkEvidence(workspace: string, entry: WorkEvidence) {
  if (entry.kind !== 'write') return [];
  if (entry.status !== 'success' && entry.status !== 'partial') return [];
  const input = isRecord(entry.input) ? entry.input : {};
  const raw = [
    entry.rawRef,
    ...entry.evidenceRefs,
    stringField(input.path),
    stringField(input.file),
    stringField(input.filePath),
    stringField(input.outputRef),
  ].filter((value): value is string => Boolean(value));
  return raw.flatMap((ref) => workspaceCandidateRef(workspace, ref) ?? []);
}

function workspaceCandidateRef(workspace: string, value: string) {
  const withoutFileScheme = value.trim().replace(/^file:/, '');
  if (!withoutFileScheme || /^[a-z][a-z0-9+.-]*:\/\//i.test(withoutFileScheme)) return undefined;
  const workspaceRoot = resolve(workspace);
  const resolved = withoutFileScheme.startsWith('/')
    ? resolve(withoutFileScheme)
    : resolve(workspaceRoot, withoutFileScheme);
  const rel = relative(workspaceRoot, resolved).split(sep).join('/');
  if (!rel || rel.startsWith('..') || rel.includes('/../')) return undefined;
  if (!candidateExtensionAllowed(rel)) return undefined;
  if (/^\.sciforge\/(?:logs|debug|handoffs|task-inputs|records)\//.test(rel)) return undefined;
  return rel;
}

function candidateExtensionAllowed(ref: string) {
  const ext = extname(ref).toLowerCase();
  return [
    '.py', '.ipynb', '.r', '.jl', '.m', '.js', '.jsx', '.ts', '.tsx', '.sh',
    '.md', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml', '.html', '.pdf',
    '.png', '.jpg', '.jpeg', '.svg',
  ].includes(ext);
}

function candidateArtifactForWorkspaceRef(ref: string) {
  const id = artifactIdForWorkspaceRef(ref);
  const ext = extname(ref).toLowerCase() || '.txt';
  return {
    id,
    type: mediaTypeForExtension(ext),
    producerScenario: 'agentserver-side-effect-salvage',
    schemaVersion: 'sciforge.runtime-artifact.v1',
    path: ref,
    metadata: {
      title: ref.split('/').at(-1) ?? ref,
      role: 'completion-candidate',
      sourceRef: ref,
      verificationStatus: 'unverified',
    },
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role: 'supporting-evidence',
      declaredMediaType: mediaTypeForExtension(ext),
      declaredExtension: ext.replace(/^\./, ''),
      contentShape: contentShapeForExtension(ext),
      readableRef: ref,
      rawRef: ref,
      previewPolicy: previewPolicyForExtension(ext),
    },
  };
}

function artifactIdForWorkspaceRef(ref: string) {
  return `agentserver-candidate-${ref.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 72)}`;
}

function mediaTypeForExtension(ext: string) {
  if (ext === '.md') return 'text/markdown';
  if (['.py', '.r', '.jl', '.m', '.js', '.jsx', '.ts', '.tsx', '.sh', '.txt'].includes(ext)) return 'text/plain';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.tsv') return 'text/tab-separated-values';
  if (ext === '.json') return 'application/json';
  if (ext === '.html') return 'text/html';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function contentShapeForExtension(ext: string) {
  if (ext === '.json') return 'json-envelope';
  if (['.png', '.jpg', '.jpeg', '.svg'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'document';
  return 'text';
}

function previewPolicyForExtension(ext: string) {
  return ['.pdf', '.ipynb'].includes(ext) ? 'open-system' : 'inline';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
