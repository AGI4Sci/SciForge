export const CONVERSATION_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.conversation.acceptance.v1' as const;

type JsonMap = Record<string, unknown>;

const DEFAULT_MARKDOWN_REPORT_TYPE = ['research', 'report'].join('-');

interface AcceptanceFailure {
  code: string;
  detail: string;
  severity?: string;
  nextActions: string[];
  evidenceRefs?: string[];
}

export interface ConversationAcceptanceResult {
  schemaVersion: typeof CONVERSATION_ACCEPTANCE_SCHEMA_VERSION;
  pass: boolean;
  status: 'accepted' | 'rejected';
  severity: string;
  failures: AcceptanceFailure[];
  reason: { code: string; message: string } | null;
  nextActions: string[];
  evidenceRefs: string[];
}

export interface ConversationAcceptanceInput {
  goal?: unknown;
  response?: unknown;
  session?: unknown;
}

export function evaluateConversationAcceptance(input: ConversationAcceptanceInput = {}): ConversationAcceptanceResult {
  const goal = recordValue(input.goal) ?? {};
  const response = recordValue(input.response) ?? {};
  const session = recordValue(input.session) ?? {};
  const failures: AcceptanceFailure[] = [];

  const run = recordValue(response.run) ?? {};
  const status = stringValue(response.status) ?? stringValue(run.status);
  const text = responseText(response);
  const artifacts = artifactsFor(response, session);

  if (status && ['failed', 'failed-with-reason', 'error'].includes(status)) {
    failures.push(failure(
      'backend-failed',
      stringValue(response.failureReason) ?? stringValue(response.error) ?? 'Backend run failed.',
      {
        nextActions: ['Preserve failureReason/log refs in context.', 'Run repair or return failed-with-reason to the user.'],
        severity: 'blocking',
        evidenceRefs: refs(response),
      },
    ));
  }

  if (!text && !artifacts.length && !refs(response).length) {
    failures.push(failure(
      'missing-output',
      'Response contains no user-visible text, artifacts, or output refs.',
      {
        nextActions: ['Ask backend to regenerate the final answer.', 'Return failed-with-reason if no output ref can be recovered.'],
        severity: 'blocking',
      },
    ));
  }

  for (const required of requiredArtifacts(goal)) {
    const requiredType = String(required.type);
    const match = findArtifact(artifacts, requiredType);
    if (!match) {
      failures.push(failure(
        code('missing', 'required', 'artifact'),
        `Required artifact is missing: ${requiredType}.`,
        {
          nextActions: [`Regenerate a ${requiredType} artifact.`, 'Keep the failed attempt and artifact contract in the next repair prompt.'],
          evidenceRefs: refs(response),
        },
      ));
      continue;
    }
    if (required.requiresRef !== false && !hasArtifactRef(match)) {
      failures.push(failure(
        code('missing', 'artifact', 'ref'),
        `Required artifact ${requiredType} has no durable ref/path.`,
        {
          nextActions: ['Persist the artifact to the workspace.', 'Return a durable workspace ref field such as dataRef, path, or markdownRef.'],
          evidenceRefs: refs(match),
        },
      ));
    }
    if (required.requiresMarkdown === true && !hasMarkdownReport(match)) {
      failures.push(failure(
        'missing-markdown-report',
        `Required artifact ${requiredType} does not include markdown content or markdownRef.`,
        {
          nextActions: ['Write a markdown report artifact.', 'Return markdownRef or markdown content bound to the report artifact.'],
          evidenceRefs: refs(match),
        },
      ));
    }
  }

  if (requiresMarkdownReport(goal) && !artifacts.some(hasMarkdownReport)) {
    failures.push(failure(
      'missing-markdown-report',
      'The turn requires a markdown report, but no markdown report/ref was returned.',
      {
        nextActions: ['Produce a research-report artifact with markdown or markdownRef.', 'Do not mark the run successful until the report ref is present.'],
        evidenceRefs: refs(response),
      },
    ));
  }

  const passed = failures.length === 0;
  return {
    schemaVersion: CONVERSATION_ACCEPTANCE_SCHEMA_VERSION,
    pass: passed,
    status: passed ? 'accepted' : 'rejected',
    severity: passed ? 'accepted' : severityFor(failures),
    failures,
    reason: passed ? null : {
      code: 'acceptance-failed',
      message: failures.map((item) => item.detail).join('; '),
    },
    nextActions: passed ? [] : dedupe(failures.flatMap((item) => item.nextActions)),
    evidenceRefs: dedupe(failures.flatMap((item) => item.evidenceRefs ?? [])),
  };
}

export const evaluateAcceptance = evaluateConversationAcceptance;

function requiredArtifacts(goal: JsonMap): Array<{ type: string; requiresRef: boolean; requiresMarkdown: boolean }> {
  const raw = goal.requiredArtifacts ?? goal.required_artifacts;
  const out: Array<{ type: string; requiresRef: boolean; requiresMarkdown: boolean }> = [];
  for (const item of arrayValue(raw)) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ type: item.trim(), requiresRef: true, requiresMarkdown: false });
      continue;
    }
    const record = recordValue(item);
    if (!record) continue;
    const artifactType = stringValue(record.type) ?? stringValue(record.artifactType) ?? stringValue(record.id);
    if (!artifactType) continue;
    out.push({
      type: artifactType,
      requiresRef: (record.requiresRef ?? record.refRequired ?? true) !== false,
      requiresMarkdown: (record.requiresMarkdown ?? record.markdownRequired ?? false) === true,
    });
  }
  if (requiresMarkdownReport(goal) && !out.some((item) => item.type === DEFAULT_MARKDOWN_REPORT_TYPE)) {
    out.push({ type: DEFAULT_MARKDOWN_REPORT_TYPE, requiresRef: true, requiresMarkdown: true });
  }
  return out;
}

function requiresMarkdownReport(goal: JsonMap): boolean {
  const formats = new Set(stringArrayValue(goal.requiredFormats).map((item) => item.toLowerCase()));
  const prompt = stringValue(goal.prompt) ?? stringValue(goal.summary) ?? stringValue(goal.instruction) ?? '';
  const lower = prompt.toLowerCase();
  return formats.has('markdown')
    || formats.has('report')
    || ['markdown report', 'research report', '报告', '综述'].some((token) => lower.includes(token));
}

function responseText(response: JsonMap): string | undefined {
  const message = recordValue(response.message) ?? {};
  const run = recordValue(response.run) ?? {};
  return stringValue(response.finalText)
    ?? stringValue(response.text)
    ?? stringValue(response.output)
    ?? stringValue(response.message)
    ?? stringValue(message.content)
    ?? stringValue(run.output)
    ?? stringValue(run.finalText);
}

function artifactsFor(response: JsonMap, session: JsonMap): JsonMap[] {
  const run = recordValue(response.run) ?? {};
  const payload = recordValue(response.payload) ?? {};
  return [
    ...arrayValue(response.artifacts),
    ...arrayValue(run.artifacts),
    ...arrayValue(payload.artifacts),
    ...arrayValue(session.artifacts),
  ].map(recordValue).filter((item): item is JsonMap => Boolean(item));
}

function findArtifact(artifacts: JsonMap[], artifactType: string): JsonMap | undefined {
  const aliases = new Set([artifactType, artifactType.replaceAll('_', '-'), artifactType.replaceAll('-', '_')]);
  return artifacts.find((artifact) => {
    const value = stringValue(artifact.type) ?? stringValue(artifact.artifactType) ?? stringValue(artifact.id) ?? '';
    return aliases.has(value);
  });
}

function hasArtifactRef(artifact: JsonMap): boolean {
  return ['ref', 'dataRef', 'path', 'filePath', 'markdownRef', 'contentRef', 'outputRef']
    .some((key) => Boolean(stringValue(artifact[key])));
}

function hasMarkdownReport(artifact: JsonMap): boolean {
  if (stringValue(artifact.markdown) || stringValue(artifact.markdownContent)) return true;
  const ref = stringValue(artifact.markdownRef)
    ?? stringValue(artifact.contentRef)
    ?? stringValue(artifact.path)
    ?? stringValue(artifact.dataRef);
  if (ref && ref.toLowerCase().split('?')[0].endsWith('.md')) return true;
  if (ref && ref.toLowerCase().split('?')[0].endsWith('.markdown')) return true;
  const data = recordValue(artifact.data) ?? {};
  return Boolean(stringValue(data.markdown) ?? stringValue(data.reportMarkdown) ?? stringValue(data.content));
}

function refs(value: JsonMap): string[] {
  const out: string[] = [];
  for (const key of ['ref', 'dataRef', 'path', 'filePath', 'markdownRef', 'contentRef', 'outputRef', 'stdoutRef', 'stderrRef']) {
    const item = stringValue(value[key]);
    if (item) out.push(item);
  }
  for (const key of ['artifactRefs', 'resultRefs', 'traceRefs', 'evidenceRefs']) {
    out.push(...stringArrayValue(value[key]));
  }
  return dedupe(out);
}

function failure(
  code: string,
  detail: string,
  options: { nextActions: string[]; severity?: string; evidenceRefs?: string[] },
): AcceptanceFailure {
  return {
    code,
    detail,
    nextActions: options.nextActions,
    severity: options.severity,
    evidenceRefs: options.evidenceRefs,
  };
}

function severityFor(failures: AcceptanceFailure[]): string {
  return failures.some((item) => item.severity === 'blocking') ? 'blocking' : 'repairable';
}

function recordValue(value: unknown): JsonMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonMap;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArrayValue(value: unknown): string[] {
  return arrayValue(value).filter((item): item is string | number | boolean => item !== null && item !== undefined).map(String);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function code(...parts: string[]): string {
  return parts.join('-');
}
