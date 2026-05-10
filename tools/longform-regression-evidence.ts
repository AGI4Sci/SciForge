import { join } from 'node:path';
import type { DeepRunManifest } from './deep-test-manifest';

export function expectedArtifactsFromRound(round: DeepRunManifest['rounds'][number] | undefined) {
  if (!round?.expectedBehavior) return [];
  const match = round.expectedBehavior.match(/Expected artifacts:\s*(.+)$/im);
  if (!match?.[1]) return [];
  return match[1].split(',').map((item) => item.trim()).filter(Boolean);
}

export function renderRecordRoundCommand(manifest: DeepRunManifest, round: DeepRunManifest['rounds'][number]) {
  const manifestPath = manifestPathForScenario(manifest.scenarioId);
  const artifactRef = round.artifactRefs?.[0] ?? expectedArtifactsFromRound(round)[0] ?? `round-${round.round}-artifact`;
  const executionRef = round.executionUnitRefs?.[0] ?? `execution-round-${round.round}`;
  const screenshotRef = round.screenshotRefs?.[0] ?? `screenshot-round-${round.round}`;
  return [
    'npm run longform:record-round --',
    `--manifest ${shellQuote(manifestPath)}`,
    `--round ${round.round}`,
    '--status passed',
    `--observed ${shellQuote(`Round ${round.round} completed; summarize backend stream, reference impact, artifacts, and blockers here.`)}`,
    `--artifact-ref ${shellQuote(artifactRef)}`,
    `--execution-ref ${shellQuote(executionRef)}`,
    `--screenshot-ref ${shellQuote(screenshotRef)}`,
  ].join(' ');
}

export function renderGapCommands(
  manifest: DeepRunManifest,
  missingEvidenceClasses: string[],
  producedArtifacts: boolean,
  completedAt: boolean,
  referenceImpact: boolean,
) {
  const manifestPath = manifestPathForScenario(manifest.scenarioId);
  const commands: string[] = [];
  if (manifest.rounds.some((round) => round.status !== 'passed')) {
    commands.push(`npm run longform:next-round -- --manifest ${shellQuote(manifestPath)}`);
  }
  if (!producedArtifacts) {
    commands.push(renderArtifactEvidenceCommand(manifestPath, manifest));
  }
  if (missingEvidenceClasses.includes('browser')) {
    commands.push(renderBrowserScreenshotCommand(manifestPath, manifest));
  }
  if (missingEvidenceClasses.includes('computer-use')) {
    commands.push(renderComputerUseScreenshotCommand(manifestPath, manifest));
  }
  if (missingEvidenceClasses.includes('workspace')) {
    commands.push(renderExecutionEvidenceCommand(manifestPath, manifest));
  }
  if (!completedAt || !referenceImpact) {
    commands.push([
      'npm run longform:finalize --',
      `--manifest ${shellQuote(manifestPath)}`,
      '--status passed',
      '--coverage-stage real-data-success',
      `--notes ${shellQuote('Explicit references changed the final answer, artifacts, plan, or next step.')}`,
    ].join(' '));
  }
  return commands;
}

export function manifestPathForScenario(scenarioId: string) {
  return join('docs', 'test-artifacts', 'deep-scenarios', scenarioId, 'manifest.json');
}

export function renderArtifactEvidenceCommand(manifestPath: string, manifest: DeepRunManifest) {
  const artifact = primaryArtifactForManifest(manifest);
  return [
    'npm run longform:record-evidence --',
    `--manifest ${shellQuote(manifestPath)}`,
    '--kind artifact',
    `--id ${shellQuote(artifact.id)}`,
    `--type ${shellQuote(artifact.type)}`,
    `--path ${shellQuote(artifact.path)}`,
    '--status produced',
    `--summary ${shellQuote('Produced artifact records how explicit references affected the answer, artifact, plan, or next step.')}`,
  ].join(' ');
}

export function renderExecutionEvidenceCommand(manifestPath: string, manifest: DeepRunManifest) {
  const execution = primaryExecutionForManifest(manifest);
  const artifact = primaryArtifactForManifest(manifest);
  return [
    'npm run longform:record-evidence --',
    `--manifest ${shellQuote(manifestPath)}`,
    '--kind execution-unit',
    `--id ${shellQuote(execution.id)}`,
    '--status done',
    `--tool ${shellQuote(execution.tool)}`,
    `--logRef ${shellQuote(execution.logRef)}`,
    `--artifactRefs ${shellQuote(artifact.id)}`,
  ].join(' ');
}

export function renderBrowserScreenshotCommand(manifestPath: string, manifest: DeepRunManifest) {
  const id = uniqueEvidenceId(manifest, 'browser-evidence', manifest.screenshots.map((screenshot) => screenshot.id));
  return [
    'npm run longform:record-evidence --',
    `--manifest ${shellQuote(manifestPath)}`,
    '--kind screenshot',
    `--id ${shellQuote(id)}`,
    `--path ${shellQuote(`screenshots/${id}.png`)}`,
    `--caption ${shellQuote('Browser evidence for the longform state, reference chips, highlighted source, or produced artifact.')}`,
  ].join(' ');
}

export function renderComputerUseScreenshotCommand(manifestPath: string, manifest: DeepRunManifest) {
  const id = uniqueEvidenceId(manifest, 'computer-use-evidence', manifest.screenshots.map((screenshot) => screenshot.id));
  return [
    'npm run longform:record-evidence --',
    `--manifest ${shellQuote(manifestPath)}`,
    '--kind screenshot',
    `--id ${shellQuote(id)}`,
    `--path ${shellQuote(`screenshots/${id}.png`)}`,
    `--caption ${shellQuote('Computer Use evidence for text selection, context menu, chip focus, scrolling, or source highlight.')}`,
  ].join(' ');
}

function primaryArtifactForManifest(manifest: DeepRunManifest) {
  const existing = manifest.artifacts.find((artifact) => artifact.status !== 'missing');
  if (existing) {
    return {
      id: existing.id,
      type: existing.type,
      path: existing.path ?? artifactPathForId(existing.id),
    };
  }
  const expected = [...manifest.rounds].reverse().flatMap(expectedArtifactsFromRound).find(Boolean);
  const id = expected ? stableEvidenceId(expected) : `${stableEvidenceId(manifest.scenarioId)}-artifact`;
  return {
    id,
    type: inferArtifactType(id),
    path: artifactPathForId(id),
  };
}

function primaryExecutionForManifest(manifest: DeepRunManifest) {
  const existing = manifest.executionUnits.find((unit) => unit.status && !/missing/i.test(unit.status));
  if (existing) {
    return {
      id: existing.id,
      tool: existing.tool ?? manifest.runtimeProfile.agentBackend ?? 'sciforge-runtime',
      logRef: existing.logRef ?? `.sciforge/logs/${stableEvidenceId(existing.id)}.log`,
    };
  }
  const id = `${stableEvidenceId(manifest.scenarioId)}-execution`;
  return {
    id,
    tool: manifest.runtimeProfile.agentBackend ?? manifest.runtimeProfile.runtimeProfileId ?? 'sciforge-runtime',
    logRef: `.sciforge/logs/${id}.log`,
  };
}

function uniqueEvidenceId(manifest: DeepRunManifest, base: string, existing: string[]) {
  const scenarioBase = `${stableEvidenceId(manifest.scenarioId)}-${base}`;
  if (!existing.includes(scenarioBase)) return scenarioBase;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${scenarioBase}-${index}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${scenarioBase}-${Date.now()}`;
}

function stableEvidenceId(value: string) {
  return value
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'artifact';
}

function inferArtifactType(id: string) {
  if (/\b(report|markdown|memo|plan)\b|\.md$|\.markdown$/i.test(id)) return 'research-report';
  if (/\b(table|matrix|csv|tsv)\b|\.csv$|\.tsv$/i.test(id)) return 'table';
  if (/\b(notebook|ipynb)\b|\.ipynb$/i.test(id)) return 'notebook';
  if (/\b(fig|figure|plot|png|jpg|jpeg|svg)\b|\.(png|jpg|jpeg|svg)$/i.test(id)) return 'figure';
  if (/\b(json|audit|manifest)\b|\.json$/i.test(id)) return 'json';
  return 'artifact';
}

function artifactPathForId(id: string) {
  const normalized = stableEvidenceId(id);
  if (/\.[a-z0-9]+$/i.test(id)) return `.sciforge/artifacts/${id}`;
  if (/report|memo|plan/i.test(id)) return `.sciforge/artifacts/${normalized}.md`;
  if (/table|matrix/i.test(id)) return `.sciforge/artifacts/${normalized}.csv`;
  if (/audit|manifest/i.test(id)) return `.sciforge/artifacts/${normalized}.json`;
  return `.sciforge/artifacts/${normalized}`;
}

export function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
