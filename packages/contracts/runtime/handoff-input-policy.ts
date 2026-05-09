export interface BackendInputTextAnchorOptions {
  maxInlineStringChars: number;
}

export function buildBackendInputTextAnchors(value: string, options: BackendInputTextAnchorOptions): string[] {
  const anchors: string[] = [];
  const snapshot = extractCurrentTurnSnapshot(value);
  if (snapshot) {
    anchors.push(
      'CURRENT TURN SNAPSHOT:',
      stringifyJson(compactAnchorValue(snapshot, 0)).slice(0, Math.max(1200, options.maxInlineStringChars)),
    );
  } else {
    const promptExcerpt = excerptAroundPattern(value, CURRENT_TURN_EXCERPT_PATTERN, options.maxInlineStringChars);
    if (promptExcerpt) {
      anchors.push('CURRENT TURN EXCERPT:', promptExcerpt);
    }
  }

  const excerptMaxChars = Math.min(4000, options.maxInlineStringChars);
  const contractExcerpt = excerptAroundPattern(value, OUTPUT_CONTRACT_EXCERPT_PATTERN, excerptMaxChars);
  if (contractExcerpt) {
    anchors.push('OUTPUT CONTRACT EXCERPT:', contractExcerpt);
  }

  const recoveryExcerpt = excerptAroundPattern(value, RECOVERY_CONTEXT_EXCERPT_PATTERN, excerptMaxChars)
    ?? excerptAroundPattern(value, PRIOR_ATTEMPTS_EXCERPT_PATTERN, excerptMaxChars);
  if (recoveryExcerpt) {
    anchors.push('RECOVERY CONTEXT EXCERPT:', recoveryExcerpt);
  }
  return anchors;
}

const CURRENT_TURN_EXCERPT_PATTERN = /"prompt"\s*:\s*"|currentUserRequest|rawUserPrompt|Current user request:/i;
const OUTPUT_CONTRACT_EXCERPT_PATTERN = /Final output must be only compact JSON|taskContract|outputPayloadKeys|AgentServerGenerationResponse|SciForge ToolPayload/i;
const RECOVERY_CONTEXT_EXCERPT_PATTERN = /timed out or was cancelled|failureReason"\s*:|"failureReason":|schemaErrors/i;
const PRIOR_ATTEMPTS_EXCERPT_PATTERN = /priorAttempts/i;

function extractCurrentTurnSnapshot(value: string) {
  const explicitMarker = 'CURRENT TURN SNAPSHOT';
  const explicitIndex = value.indexOf(explicitMarker);
  if (explicitIndex >= 0) {
    const objectStart = value.indexOf('{', explicitIndex);
    const parsed = parseJsonObjectAt(value, objectStart);
    if (parsed) return parsed;
  }
  for (const marker of ['\n{\n  "prompt"', '\n{"prompt"', '"prompt":']) {
    const index = value.lastIndexOf(marker);
    if (index < 0) continue;
    const objectStart = marker.startsWith('"') ? value.lastIndexOf('{', index) : value.indexOf('{', index);
    const parsed = parseJsonObjectAt(value, objectStart);
    if (!isRecord(parsed)) continue;
    return {
      kind: 'SciForgeCurrentTurnSnapshot',
      prompt: parsed.prompt,
      skillDomain: parsed.skillDomain,
      expectedArtifactTypes: parsed.expectedArtifactTypes,
      selectedComponentIds: parsed.selectedComponentIds,
      strictTaskFilesReason: parsed.strictTaskFilesReason,
      taskContract: parsed.taskContract,
      contextEnvelope: currentTurnEnvelopeSummary(parsed.contextEnvelope),
      uiStateSummary: currentTurnUiSummary(parsed.uiStateSummary),
    };
  }
  return undefined;
}

function parseJsonObjectAt(value: string, start: number) {
  if (start < 0 || value[start] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(value.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function currentTurnEnvelopeSummary(value: unknown) {
  if (!isRecord(value)) return undefined;
  const sessionFacts = isRecord(value.sessionFacts) ? value.sessionFacts : {};
  const scenarioFacts = isRecord(value.scenarioFacts) ? value.scenarioFacts : {};
  const longTermRefs = isRecord(value.longTermRefs) ? value.longTermRefs : {};
  return {
    version: value.version,
    mode: value.mode,
    scenarioFacts: {
      expectedArtifactTypes: scenarioFacts.expectedArtifactTypes,
      selectedComponentIds: scenarioFacts.selectedComponentIds,
      selectedToolIds: scenarioFacts.selectedToolIds,
      selectedSenseIds: scenarioFacts.selectedSenseIds,
    },
    sessionFacts: {
      currentUserRequest: sessionFacts.currentUserRequest,
      currentPrompt: sessionFacts.currentPrompt,
      currentReferences: sessionFacts.currentReferences,
      currentReferenceDigests: sessionFacts.currentReferenceDigests,
      recentConversation: sessionFacts.recentConversation,
    },
    longTermRefs: {
      artifacts: summarizeAnchorArray(longTermRefs.artifacts, 6),
      recentExecutionRefs: summarizeAnchorArray(longTermRefs.recentExecutionRefs, 6),
      priorAttempts: summarizeAnchorArray(longTermRefs.priorAttempts, 3),
    },
  };
}

function currentTurnUiSummary(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    currentPrompt: value.currentPrompt,
    rawUserPrompt: value.rawUserPrompt,
    expectedArtifactTypes: value.expectedArtifactTypes,
    selectedComponentIds: value.selectedComponentIds,
    selectedToolIds: value.selectedToolIds,
    selectedSenseIds: value.selectedSenseIds,
    currentReferences: value.currentReferences,
    currentReferenceDigests: value.currentReferenceDigests,
    recentExecutionRefs: summarizeAnchorArray(value.recentExecutionRefs, 6),
  };
}

function summarizeAnchorArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return value;
  return value.slice(-maxItems).map((item) => compactAnchorValue(item, 0));
}

function compactAnchorValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 900)}\n...[omitted ${value.length - 1200} chars]...\n${value.slice(-300)}` : value;
  if (typeof value !== 'object') return value;
  if (depth >= 4) return handoffAnchorSummary(value);
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => compactAnchorValue(item, depth + 1));
  if (!isRecord(value)) return handoffAnchorSummary(value);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, 32)) {
    out[key] = compactAnchorValue(nested, depth + 1);
  }
  if (Object.keys(value).length > 32) out._omittedFieldCount = Object.keys(value).length - 32;
  return out;
}

function handoffAnchorSummary(value: unknown) {
  return {
    _sciforgeCompacted: true,
    kind: Array.isArray(value) ? 'array' : typeof value,
    schema: inferJsonSchema(value),
  };
}

function excerptAroundPattern(value: string, pattern: RegExp, maxChars: number) {
  const match = pattern.exec(value);
  if (!match) return undefined;
  const radius = Math.max(600, Math.floor(maxChars / 2));
  const start = Math.max(0, match.index - radius);
  const end = Math.min(value.length, match.index + radius);
  return [
    start > 0 ? '[...]' : '',
    value.slice(start, end),
    end < value.length ? '[...]' : '',
  ].join('');
}

function inferJsonSchema(value: unknown, depth = 0): unknown {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      itemCount: value.length,
      items: value.length && depth < 2 ? inferJsonSchema(value[0], depth + 1) : undefined,
    };
  }
  if (typeof value !== 'object') return { type: typeof value };
  if (!isRecord(value)) return { type: 'object' };
  const entries = Object.entries(value).slice(0, 24);
  return {
    type: 'object',
    keys: Object.keys(value).slice(0, 40),
    properties: depth < 2
      ? Object.fromEntries(entries.map(([key, nested]) => [key, inferJsonSchema(nested, depth + 1)]))
      : undefined,
  };
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: String(value) });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
