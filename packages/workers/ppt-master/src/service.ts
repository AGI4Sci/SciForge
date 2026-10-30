import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path';

export const PPT_MASTER_ENV_SKILL_DIR = 'PPT_MASTER_SKILL_DIR';
export const PPT_MASTER_ENV_PYTHON = 'PPT_MASTER_PYTHON';

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_EXPORT_TIMEOUT_MS = 300_000;
const DEFAULT_SCIFORGE_STYLE_PRESET = 'auto';
const SCIFORGE_RESEARCH_STYLE_PRESET = 'sciforge_research';
const SCIENTIFIC_MODALITY_EXTENSIONS =
  /\.(?:fasta|fa|faa|fna|ffn|frn|fastq|fq|smi|smiles|mol|mol2|sdf|mgf|pdb|cif|gb|gbk|gff|gff3|gtf|vcf|bed|nwk|seq)(?:$|[?#])/i;
const PRESENTATION_FIGURE_EXTENSIONS = /\.(?:png|jpg|jpeg|webp|svg|pdf)(?:$|[?#])/i;

const SCRIPT_PATHS = {
  projectManager: ['scripts', 'project_manager.py'],
  pdfToMd: ['scripts', 'source_to_md', 'pdf_to_md.py'],
  docToMd: ['scripts', 'source_to_md', 'doc_to_md.py'],
  excelToMd: ['scripts', 'source_to_md', 'excel_to_md.py'],
  pptToMd: ['scripts', 'source_to_md', 'ppt_to_md.py'],
  webToMd: ['scripts', 'source_to_md', 'web_to_md.py'],
  totalMdSplit: ['scripts', 'total_md_split.py'],
  svgQualityChecker: ['scripts', 'svg_quality_checker.py'],
  finalizeSvg: ['scripts', 'finalize_svg.py'],
  svgToPptx: ['scripts', 'svg_to_pptx.py']
} as const;

type ScriptKey = keyof typeof SCRIPT_PATHS;

export type CommandResult = {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type SplitNotesAutoRepair = {
  attempted: boolean;
  status: 'skipped' | 'already_aligned' | 'repaired_and_retried' | 'retry_failed';
  reason?: string;
  notesPath?: string;
  backupPath?: string;
  svgStems?: string[];
  renamedHeadings?: Array<{
    line: number;
    from: string;
    to: string;
  }>;
  firstExitCode?: number | null;
  retryExitCode?: number | null;
};

export type SplitNotesResult = CommandResult & {
  autoRepair?: SplitNotesAutoRepair;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }
) => Promise<CommandResult>;

export type PptMasterServiceOptions = {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  now?: () => Date;
  runCommand?: CommandRunner;
  workspaceRoot?: string;
};

export type PptMasterResolvedConfig = {
  skillDir: string;
  python: string;
  workspaceRoot?: string;
};

export type SciForgeSourceFile = {
  path: string;
  title?: string;
  kind?: string;
  mimeType?: string;
  modelRouterObject?: boolean;
};

export type SciForgeQuotedSelection = {
  sourceTitle?: string;
  sourceFilePath?: string;
  location?: string;
  text: string;
};

export type SciForgeWriteMarkdown = {
  path?: string;
  title?: string;
  content: string;
};

export type SciForgeModelRouterEvidence = {
  source?: string;
  modality?: string;
  model?: string;
  summary?: string;
  text: string;
};

export type SciForgeFigure = {
  path: string;
  title?: string;
  caption?: string;
  source?: string;
  evidenceIds?: string[];
  altText?: string;
  kind?: string;
};

type StagedSciForgeFigure = {
  originalPath: string;
  stagedPath: string;
  assetPath: string;
  projectRelativePath: string;
  title?: string;
  caption?: string;
  source?: string;
  evidenceIds: string[];
  altText?: string;
  kind?: string;
  handling: 'presentation-figure-asset';
  reason: string;
};

export type SciForgeIntakeInput = {
  workspaceRoot?: string;
  projectPath?: string;
  deckSlug?: string;
  title?: string;
  audience?: string;
  stylePreset?: string;
  thread?: {
    id?: string;
    title?: string;
  };
  task?: {
    id?: string;
    title?: string;
  };
  sourceFiles?: SciForgeSourceFile[];
  quotedSelections?: SciForgeQuotedSelection[];
  writeMarkdown?: SciForgeWriteMarkdown;
  modelRouterEvidence?: SciForgeModelRouterEvidence[];
  figures?: SciForgeFigure[];
  notes?: string;
  importSources?: boolean;
};

export type PptMasterService = ReturnType<typeof createPptMasterService>;

export function createPptMasterService(options: PptMasterServiceOptions = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const now = options.now ?? (() => new Date());
  const runCommand = options.runCommand ?? defaultRunCommand;
  const configuredWorkspaceRoot = options.workspaceRoot?.trim()
    ? resolveHome(options.workspaceRoot.trim(), homeDir)
    : undefined;

  const config = (): PptMasterResolvedConfig => ({
    skillDir: resolveHome(env[PPT_MASTER_ENV_SKILL_DIR] ?? '~/.codex/skills/ppt-master', homeDir),
    python: env[PPT_MASTER_ENV_PYTHON]?.trim() || defaultPythonFor(homeDir),
    ...(configuredWorkspaceRoot ? { workspaceRoot: configuredWorkspaceRoot } : {})
  });

  const scriptPath = (key: ScriptKey): string => join(config().skillDir, ...SCRIPT_PATHS[key]);

  const runScript = async (
    key: ScriptKey,
    args: string[],
    commandOptions: { cwd?: string; timeoutMs?: number } = {}
  ): Promise<CommandResult> => {
    const resolved = config();
    const script = join(resolved.skillDir, ...SCRIPT_PATHS[key]);
    return runCommand(resolved.python, [script, ...args], {
      cwd: commandOptions.cwd,
      env: stringEnv(env),
      timeoutMs: commandOptions.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    });
  };

  const workspaceRootFor = (inputWorkspaceRoot?: string): string => {
    const input = inputWorkspaceRoot?.trim()
      ? resolveHome(inputWorkspaceRoot.trim(), homeDir)
      : undefined;
    if (configuredWorkspaceRoot) {
      if (input && input !== configuredWorkspaceRoot) {
        throw new Error(`workspaceRoot must match configured workspaceRoot: ${input}`);
      }
      return configuredWorkspaceRoot;
    }
    if (!input) {
      throw new Error('workspaceRoot is required. Launch this MCP with --workspace-root or pass workspaceRoot to the tool.');
    }
    return input;
  };

  const resolveWriteProjectPath = (input: { workspaceRoot?: string; projectPath: string }): {
    workspaceRoot: string;
    projectPath: string;
  } => {
    const workspaceRoot = workspaceRootFor(input.workspaceRoot);
    assertDirectory(workspaceRoot, 'workspaceRoot');
    const projectPath = isAbsolute(input.projectPath)
      ? resolve(input.projectPath)
      : resolve(workspaceRoot, input.projectPath);
    assertWithin(workspaceRoot, projectPath, 'projectPath');
    return { workspaceRoot, projectPath };
  };

  return {
    config,
    scriptPath,

    async status() {
      const resolved = config();
      const scripts = Object.fromEntries(
        await Promise.all(
          Object.entries(SCRIPT_PATHS).map(async ([key, parts]) => {
            const path = join(resolved.skillDir, ...parts);
            return [key, { path, exists: existsSync(path) }];
          })
        )
      );
      const missingScripts = Object.entries(scripts)
        .filter(([, entry]) => !(entry as { exists: boolean }).exists)
        .map(([key]) => key);
      return {
        ok: existsSync(resolved.skillDir) && missingScripts.length === 0,
        skillDir: resolved.skillDir,
        python: resolved.python,
        ...(resolved.workspaceRoot ? { workspaceRoot: resolved.workspaceRoot } : {}),
        skillDirExists: existsSync(resolved.skillDir),
        scripts,
        missingScripts,
        constraints: pptMasterConstraints()
      };
    },

    async projectStatus(input: { projectPath: string }) {
      const projectPath = resolve(input.projectPath);
      const dirs = {
        sources: join(projectPath, 'sources'),
        images: join(projectPath, 'images'),
        svgOutput: join(projectPath, 'svg_output'),
        svgFinal: join(projectPath, 'svg_final'),
        notes: join(projectPath, 'notes'),
        exports: join(projectPath, 'exports')
      };
      const exportFiles = existsSync(dirs.exports)
        ? (await readdir(dirs.exports)).filter((file) => file.toLowerCase().endsWith('.pptx')).sort()
        : [];
      return {
        projectPath,
        exists: existsSync(projectPath),
        dirs: Object.fromEntries(
          Object.entries(dirs).map(([key, path]) => [key, { path, exists: existsSync(path) }])
        ),
        files: {
          designSpec: fileState(join(projectPath, 'design_spec.md')),
          specLock: fileState(join(projectPath, 'spec_lock.md')),
          totalNotes: fileState(join(projectPath, 'notes', 'total.md')),
          sciforgeContext: fileState(join(projectPath, 'sources', 'sciforge_context.md')),
          sciforgeManifest: fileState(join(projectPath, 'sources', 'sciforge_manifest.json'))
        },
        exports: exportFiles.map((file) => join(dirs.exports, file))
      };
    },

    async convertSource(input: {
      source: string;
      kind?: 'pdf' | 'doc' | 'excel' | 'ppt' | 'web';
      cwd?: string;
    }) {
      const script = conversionScriptFor(input.source, input.kind);
      const result = await runScript(script, [input.source], {
        cwd: input.cwd,
        timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS
      });
      return { script, result };
    },

    async initProject(input: {
      workspaceRoot?: string;
      deckSlug?: string;
      projectPath?: string;
      format?: string;
      sourcePaths?: string[];
    }) {
      const workspaceRoot = workspaceRootFor(input.workspaceRoot);
      assertDirectory(workspaceRoot, 'workspaceRoot');
      const projectPath = resolveProjectPath(workspaceRoot, input.projectPath, input.deckSlug);
      assertWithin(workspaceRoot, projectPath, 'projectPath');
      const sourcePaths = (input.sourcePaths ?? []).map((sourcePath) =>
        resolveWorkspaceFile(workspaceRoot, sourcePath, 'sourcePaths')
      );
      await mkdir(dirname(projectPath), { recursive: true });
      const format = input.format?.trim() || 'ppt169';
      const init = await runScript('projectManager', ['init', projectPath, '--format', format], {
        cwd: workspaceRoot,
        timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS
      });
      const initializedProjectPath = parseInitializedProjectPath(init.stdout, workspaceRoot) ?? projectPath;
      assertWithin(workspaceRoot, initializedProjectPath, 'projectPath');
      const importResult = sourcePaths.length
        ? await runScript('projectManager', ['import-sources', initializedProjectPath, ...sourcePaths, '--move'], {
            cwd: workspaceRoot,
            timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS
          })
        : undefined;
      return {
        projectPath: initializedProjectPath,
        requestedProjectPath: projectPath,
        format,
        init,
        import: importResult
      };
    },

    async sciforgeIntake(input: SciForgeIntakeInput) {
      const workspaceRoot = workspaceRootFor(input.workspaceRoot);
      assertDirectory(workspaceRoot, 'workspaceRoot');
      const projectPath = resolveProjectPath(workspaceRoot, input.projectPath, input.deckSlug ?? input.title ?? input.thread?.title);
      assertWithin(workspaceRoot, projectPath, 'projectPath');
      const stylePreset = input.stylePreset?.trim() || DEFAULT_SCIFORGE_STYLE_PRESET;

      const sourcesDir = join(projectPath, 'sources');
      const figureAssetsDir = join(projectPath, 'images', 'sciforge_figures');
      await mkdir(sourcesDir, { recursive: true });

      const stamp = formatStamp(now());
      const stagingDir = join(workspaceRoot, '.sciforge', 'ppt-master-staging', `${basename(projectPath)}-${stamp}`);
      await mkdir(stagingDir, { recursive: true });

      const stagedSources: Array<{
        originalPath: string;
        stagedPath?: string;
        title?: string;
        kind?: string;
        handling: 'staged-for-import' | 'model-router-evidence-only' | 'scientific-reference-only';
        reason?: string;
      }> = [];
      const importPaths: string[] = [];
      for (const source of input.sourceFiles ?? []) {
        const originalPath = resolveWorkspaceFile(workspaceRoot, source.path);
        const scientific = source.modelRouterObject === true || isScientificModalityPath(originalPath);
        if (scientific) {
          stagedSources.push({
            originalPath,
            title: source.title,
            kind: source.kind,
            handling: source.modelRouterObject === true ? 'model-router-evidence-only' : 'scientific-reference-only',
            reason: 'Scientific modality files stay in SciForge/Model Router evidence flow and are not imported into ppt-master as raw source.'
          });
          continue;
        }
        const sourceStat = await stat(originalPath);
        if (!sourceStat.isFile()) {
          throw new Error(`SciForge intake source must be a file: ${source.path}`);
        }
        const stagedName = uniqueStagedName(importPaths, originalPath);
        const stagedPath = join(stagingDir, stagedName);
        await copyFile(originalPath, stagedPath);
        importPaths.push(stagedPath);
        stagedSources.push({
          originalPath,
          stagedPath,
          title: source.title,
          kind: source.kind,
          handling: 'staged-for-import'
        });
      }

      const stagedFigures: StagedSciForgeFigure[] = [];
      if ((input.figures ?? []).length > 0) {
        const figureStagingDir = join(stagingDir, 'figures');
        await mkdir(figureStagingDir, { recursive: true });
        await mkdir(figureAssetsDir, { recursive: true });
        const stagedFigurePaths: string[] = [];
        const assetFigurePaths: string[] = [];
        for (const figure of input.figures ?? []) {
          const originalPath = resolveWorkspaceFile(workspaceRoot, figure.path);
          if (!isPresentationFigurePath(originalPath)) {
            throw new Error(`SciForge intake figure must be a presentation asset (png/jpg/webp/svg/pdf), not a raw scientific file: ${figure.path}`);
          }
          const sourceStat = await stat(originalPath);
          if (!sourceStat.isFile()) {
            throw new Error(`SciForge intake figure must be a file: ${figure.path}`);
          }
          const stagedName = uniqueStagedName(stagedFigurePaths, originalPath);
          const assetName = uniqueStagedName(assetFigurePaths, originalPath);
          const stagedPath = join(figureStagingDir, stagedName);
          const assetPath = join(figureAssetsDir, assetName);
          await copyFile(originalPath, stagedPath);
          await copyFile(originalPath, assetPath);
          stagedFigurePaths.push(stagedPath);
          assetFigurePaths.push(assetPath);
          stagedFigures.push({
            originalPath,
            stagedPath,
            assetPath,
            projectRelativePath: toProjectRelativePath(projectPath, assetPath),
            title: figure.title,
            caption: figure.caption,
            source: figure.source,
            evidenceIds: figure.evidenceIds ?? [],
            altText: figure.altText,
            kind: figure.kind,
            handling: 'presentation-figure-asset',
            reason: 'Existing SciForge figure copied for presentation use; ppt-master does not reinterpret the underlying scientific data.'
          });
        }
      }

      const contextPath = join(sourcesDir, 'sciforge_context.md');
      const manifestPath = join(sourcesDir, 'sciforge_manifest.json');
      const manifest = {
        schemaVersion: 'sciforge.ppt-master-intake.v2',
        createdAt: now().toISOString(),
        workspaceRoot,
        projectPath,
        title: input.title ?? input.thread?.title ?? input.task?.title ?? basename(projectPath),
        audience: input.audience,
        stylePreset,
        uiKit: {
          selectedPreset: stylePreset,
          availablePresets: [SCIFORGE_RESEARCH_STYLE_PRESET],
          productionPath: 'ppt-master-compatible static SVG layouts when a preset is explicitly selected',
          satori: 'optional validation candidate only; not used to bypass ppt-master Step 4 or sequential SVG generation'
        },
        thread: input.thread,
        task: input.task,
        stagingDir,
        sources: stagedSources,
        figures: stagedFigures,
        quotedSelections: input.quotedSelections ?? [],
        writeMarkdown: input.writeMarkdown
          ? {
              path: input.writeMarkdown.path,
              title: input.writeMarkdown.title,
              charCount: input.writeMarkdown.content.length
            }
          : undefined,
        modelRouterEvidence: input.modelRouterEvidence ?? [],
        notes: input.notes
      };
      await writeFile(contextPath, renderSciForgeContext(manifest, input), 'utf8');
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

      const importResult =
        input.importSources === false || importPaths.length === 0
          ? undefined
          : await runScript('projectManager', ['import-sources', projectPath, ...importPaths, '--move'], {
              cwd: workspaceRoot,
              timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS
            });

      return {
        projectPath,
        sourcesDir,
        contextPath,
        manifestPath,
        stagingDir,
        stagedSources,
        figures: stagedFigures,
        figureAssetCount: stagedFigures.length,
        importedSourceCount: importPaths.length,
        import: importResult
      };
    },

    async splitNotes(input: { workspaceRoot?: string; projectPath: string }): Promise<SplitNotesResult> {
      const { projectPath } = resolveWriteProjectPath(input);
      await assertPptMasterProjectPath(projectPath, 'split notes');
      const first = await runScript('totalMdSplit', [projectPath], { timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS });
      if (first.exitCode === 0) return first;

      const repair = await repairTotalNotesForSvgOutput(
        projectPath,
        `${first.stdout}\n${first.stderr}`,
        now
      );
      if (!repair.attempted || !repair.backupPath || repair.status === 'already_aligned') {
        return {
          ...first,
          autoRepair: {
            ...repair,
            firstExitCode: first.exitCode
          }
        } satisfies SplitNotesResult;
      }

      const retry = await runScript('totalMdSplit', [projectPath], { timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS });
      return {
        ...retry,
        autoRepair: {
          ...repair,
          status: retry.exitCode === 0 ? 'repaired_and_retried' : 'retry_failed',
          firstExitCode: first.exitCode,
          retryExitCode: retry.exitCode
        }
      } satisfies SplitNotesResult;
    },

    async qualityCheck(input: { projectPath: string }) {
      const projectPath = resolve(input.projectPath);
      await assertPptMasterProjectPath(projectPath, 'quality check', { requireSvgOutput: true });
      return runScript('svgQualityChecker', [projectPath], { timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS });
    },

    async finalizeSvg(input: { workspaceRoot?: string; projectPath: string }) {
      const { projectPath } = resolveWriteProjectPath(input);
      await assertPptMasterProjectPath(projectPath, 'finalize SVG');
      return runScript('finalizeSvg', [projectPath], { timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS });
    },

    async exportPptx(input: {
      workspaceRoot?: string;
      projectPath: string;
      svgSnapshot?: boolean;
      transition?: string;
      animation?: string;
      animationTrigger?: 'on-click' | 'with-previous' | 'after-previous';
      autoAdvanceSeconds?: number;
    }) {
      const { workspaceRoot, projectPath } = resolveWriteProjectPath(input);
      await assertPptMasterProjectPath(projectPath, 'export PPTX');
      const args = [projectPath];
      if (input.svgSnapshot) args.push('--svg-snapshot');
      if (input.transition) args.push('-t', input.transition);
      if (input.animation) args.push('-a', input.animation);
      if (input.animationTrigger) args.push('--animation-trigger', input.animationTrigger);
      if (input.autoAdvanceSeconds !== undefined) args.push('--auto-advance', String(input.autoAdvanceSeconds));
      const result = await runScript('svgToPptx', args, { timeoutMs: DEFAULT_EXPORT_TIMEOUT_MS });
      const pptxPath = await findLatestPptxExport(projectPath);
      const artifactManifestPath = pptxPath
        ? await writePptMasterArtifactManifest(projectPath, pptxPath, workspaceRoot)
        : undefined;
      return {
        ...result,
        ...(pptxPath ? { pptxPath } : {}),
        ...(artifactManifestPath ? { artifactManifestPath } : {})
      };
    }
  };
}

async function findLatestPptxExport(projectPath: string): Promise<string | undefined> {
  const exportsDir = join(projectPath, 'exports');
  let files: string[];
  try {
    files = (await readdir(exportsDir)).filter((file) => file.toLowerCase().endsWith('.pptx'));
  } catch {
    return undefined;
  }
  let latest: { path: string; mtimeMs: number } | undefined;
  for (const file of files) {
    const candidate = join(exportsDir, file);
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      if (!latest || info.mtimeMs > latest.mtimeMs) latest = { path: candidate, mtimeMs: info.mtimeMs };
    } catch {
      // Ignore stale export directory entries.
    }
  }
  return latest?.path;
}

async function writePptMasterArtifactManifest(
  projectPath: string,
  pptxPath: string,
  workspaceRoot = inferWorkspaceRootFromProjectPath(projectPath)
): Promise<string> {
  const artifactsDir = join(workspaceRoot, '.sciforge', 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const stem = slugify(basename(projectPath)) || 'ppt-master';
  const artifactManifestPath = join(artifactsDir, stem + '.ppt-export.artifact.json');
  const thread = await readPptMasterIntakeThread(projectPath);
  const manifest = {
    version: 1,
    kind: 'sciforge_artifact',
    createdAt: new Date().toISOString(),
    sourceTool: 'ppt_master',
    artifactKind: 'ppt_export',
    path: pptxPath,
    pptxPath,
    projectPath,
    ...(thread?.id ? { threadId: thread.id, canvasId: `thread-${thread.id}` } : {}),
    slideIndex: 0,
    title: basename(pptxPath, extname(pptxPath)),
    manifestPath: join(projectPath, 'sources', 'sciforge_manifest.json')
  };
  await writeFile(artifactManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return artifactManifestPath;
}

async function readPptMasterIntakeThread(projectPath: string): Promise<{ id?: string; title?: string } | undefined> {
  try {
    const manifestPath = join(projectPath, 'sources', 'sciforge_manifest.json');
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as { thread?: unknown };
    const thread = parsed.thread;
    if (!thread || typeof thread !== 'object') return undefined;
    const record = thread as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
    const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : undefined;
    return id || title ? { ...(id ? { id } : {}), ...(title ? { title } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

function inferWorkspaceRootFromProjectPath(projectPath: string): string {
  const marker = `${sep}presentations${sep}`;
  const index = projectPath.indexOf(marker);
  if (index > 0) return projectPath.slice(0, index);
  return dirname(projectPath);
}

function defaultRunCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeoutMs)
      : undefined;

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode, signal) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        command,
        args,
        cwd: options.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}

function renderSciForgeContext(
  manifest: {
    createdAt: string;
    workspaceRoot: string;
    projectPath: string;
    title: string;
    audience?: string;
    thread?: SciForgeIntakeInput['thread'];
    task?: SciForgeIntakeInput['task'];
    stylePreset: string;
    uiKit?: { selectedPreset: string; availablePresets: string[]; productionPath: string; satori: string };
    sources: Array<{ originalPath: string; stagedPath?: string; title?: string; kind?: string; handling: string; reason?: string }>;
    figures: StagedSciForgeFigure[];
    quotedSelections: SciForgeQuotedSelection[];
    writeMarkdown?: { path?: string; title?: string; charCount: number };
    modelRouterEvidence: SciForgeModelRouterEvidence[];
    notes?: string;
  },
  input: SciForgeIntakeInput
): string {
  const lines: string[] = [
    '# SciForge PPT Source Bundle',
    '',
    'This source bundle was generated by SciForge for ppt-master. Treat Model Router evidence as the inspected scientific signal. Do not ask ppt-master to reinterpret raw scientific modality files.',
    '',
    '## Deck Context',
    '',
    `- Title: ${manifest.title}`,
    manifest.audience ? `- Audience: ${manifest.audience}` : undefined,
    `- Created: ${manifest.createdAt}`,
    `- Workspace: ${manifest.workspaceRoot}`,
    `- Project: ${manifest.projectPath}`,
    `- Style preset: ${manifest.stylePreset}`,
    manifest.stylePreset === DEFAULT_SCIFORGE_STYLE_PRESET
      ? '- Style selection: auto; final visual direction is confirmed in ppt-master Step 4.'
      : undefined,
    manifest.thread?.id ? `- Thread: ${manifest.thread.title ?? manifest.thread.id} (${manifest.thread.id})` : undefined,
    manifest.task?.id ? `- Task: ${manifest.task.title ?? manifest.task.id} (${manifest.task.id})` : undefined,
    '',
    '## Presentation Style Selection',
    '',
    `- Selected preset: ${manifest.stylePreset}`,
    `- Available SciForge UI Kit preset: ${SCIFORGE_RESEARCH_STYLE_PRESET}`,
    manifest.stylePreset === SCIFORGE_RESEARCH_STYLE_PRESET
      ? '- Intent: restrained academic presentation, evidence-driven layout, figure-first pages, and traceable citations.'
      : '- Intent: keep PPT generation available without forcing a research visual style; Step 4 decides audience, tone, color, typography, and image approach.',
    '- Production path: ppt-master-compatible static SVG layouts only when selected; Satori remains an optional controlled component-rendering candidate.',
    '',
    '## Workspace Sources',
    '',
    '| Source | Handling | Notes |',
    '|---|---|---|',
    ...manifest.sources.map((source) => {
      const label = source.title || basename(source.originalPath);
      return `| ${escapeTable(label)} | ${source.handling} | ${escapeTable(source.reason ?? source.originalPath)} |`;
    }),
    ''
  ].filter((line): line is string => line !== undefined);

  if (manifest.figures.length > 0) {
    lines.push(
      '## Figure Catalog',
      '',
      '| Figure | Kind | Project Asset | Evidence | Notes |',
      '|---|---|---|---|---|',
      ...manifest.figures.map((figure, index) => {
        const label = figure.title || `Figure ${index + 1}`;
        const evidence = figure.evidenceIds.length > 0 ? figure.evidenceIds.join(', ') : 'n/a';
        const notes = [figure.caption, figure.source ? `Source: ${figure.source}` : undefined, figure.altText ? `Alt: ${figure.altText}` : undefined]
          .filter((value): value is string => Boolean(value?.trim()))
          .join(' ');
        return `| ${escapeTable(label)} | ${escapeTable(figure.kind ?? 'figure')} | ${escapeTable(figure.projectRelativePath)} | ${escapeTable(evidence)} | ${escapeTable(notes || figure.reason)} |`;
      }),
      ''
    );
  }

  if (manifest.quotedSelections.length > 0) {
    lines.push('## Quoted Selections', '');
    manifest.quotedSelections.forEach((selection, index) => {
      lines.push(
        `### Quote ${index + 1}: ${selection.sourceTitle ?? selection.sourceFilePath ?? 'SciForge selection'}`,
        selection.location ? `Location: ${selection.location}` : '',
        '',
        blockQuote(selection.text),
        ''
      );
    });
  }

  if (input.writeMarkdown) {
    lines.push(
      '## Write Workspace Draft',
      '',
      input.writeMarkdown.title ? `Source: ${input.writeMarkdown.title}` : '',
      input.writeMarkdown.path ? `Path: ${input.writeMarkdown.path}` : '',
      '',
      input.writeMarkdown.content,
      ''
    );
  }

  if (manifest.modelRouterEvidence.length > 0) {
    lines.push('## Model Router Scientific Evidence', '');
    manifest.modelRouterEvidence.forEach((evidence, index) => {
      lines.push(
        `### Evidence ${index + 1}: ${evidence.source ?? evidence.modality ?? 'SciForge evidence'}`,
        evidence.modality ? `Modality: ${evidence.modality}` : '',
        evidence.model ? `Model: ${evidence.model}` : '',
        evidence.summary ? `Summary: ${evidence.summary}` : '',
        '',
        evidence.text,
        ''
      );
    });
  }

  if (input.notes?.trim()) {
    lines.push('## SciForge Notes', '', input.notes.trim(), '');
  }

  lines.push(
    '## ppt-master Guardrails',
    '',
    '- Use this bundle as source material for the Strategist phase.',
    '- Present the Eight Confirmations and wait for explicit user confirmation before writing design_spec.md/spec_lock.md.',
    '- Do not batch-generate SVG pages through scripts; main-agent sequential SVG authoring remains required.',
    '- Keep raw scientific modality files in SciForge/Model Router evidence flow unless the user explicitly provides them as presentation artifacts.',
    '- Existing SciForge figure assets may be placed on PPT pages, but the scientific interpretation belongs to SciForge plotting / Model Router evidence.',
    ''
  );

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function pptMasterConstraints(): string[] {
  return [
    'Step 4 Eight Confirmations are a hard user-confirmation gate.',
    'MCP tools must not batch-generate SVG pages.',
    'Main agent must generate SVG pages sequentially and re-read spec_lock.md before each page.',
    'SciForge scientific modality files must be interpreted by Model Router/sci-modality before ppt-master consumes evidence.'
  ];
}

function conversionScriptFor(source: string, kind?: 'pdf' | 'doc' | 'excel' | 'ppt' | 'web'): ScriptKey {
  if (kind === 'pdf') return 'pdfToMd';
  if (kind === 'doc') return 'docToMd';
  if (kind === 'excel') return 'excelToMd';
  if (kind === 'ppt') return 'pptToMd';
  if (kind === 'web') return 'webToMd';
  if (/^https?:\/\//i.test(source)) return 'webToMd';
  const ext = extname(source).toLowerCase();
  if (ext === '.pdf') return 'pdfToMd';
  if (ext === '.doc' || ext === '.docx' || ext === '.html' || ext === '.htm' || ext === '.epub') return 'docToMd';
  if (ext === '.xlsx' || ext === '.xlsm' || ext === '.xls') return 'excelToMd';
  if (ext === '.ppt' || ext === '.pptx') return 'pptToMd';
  return 'docToMd';
}

function resolveProjectPath(workspaceRoot: string, projectPath?: string, deckSlug?: string): string {
  if (projectPath?.trim()) {
    const resolved = isAbsolute(projectPath) ? resolve(projectPath) : resolve(workspaceRoot, projectPath);
    return resolved;
  }
  return join(workspaceRoot, 'presentations', slugify(deckSlug ?? 'sciforge-presentation'));
}

function parseInitializedProjectPath(stdout: string, baseDir?: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/(?:Project created:|\[OK\]\s+Project initialized:)\s*(.+?)\s*$/);
    if (match?.[1]?.trim()) {
      const path = match[1].trim();
      return isAbsolute(path) ? resolve(path) : resolve(baseDir ?? process.cwd(), path);
    }
  }
  return undefined;
}

function resolveWorkspaceFile(workspaceRoot: string, value: string, label = 'source.path'): string {
  const resolved = isAbsolute(value) ? resolve(value) : resolve(workspaceRoot, value);
  assertWithin(workspaceRoot, resolved, label);
  return resolved;
}

function assertWithin(parent: string, child: string, label: string): void {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return;
  throw new Error(`${label} must stay inside workspaceRoot: ${child}`);
}

function assertDirectory(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
}

async function repairTotalNotesForSvgOutput(
  projectPath: string,
  diagnostic: string,
  now: () => Date
): Promise<SplitNotesAutoRepair> {
  if (!/(?:Missing notes|SVG files and notes do not match)/i.test(diagnostic)) {
    return {
      attempted: false,
      status: 'skipped',
      reason: 'split failure did not look like an SVG/notes title mismatch'
    };
  }

  const notesPath = join(projectPath, 'notes', 'total.md');
  const svgOutputDir = join(projectPath, 'svg_output');
  if (!existsSync(notesPath)) {
    return {
      attempted: true,
      status: 'skipped',
      reason: `notes/total.md does not exist: ${notesPath}`,
      notesPath
    };
  }
  if (!existsSync(svgOutputDir)) {
    return {
      attempted: true,
      status: 'skipped',
      reason: `svg_output does not exist: ${svgOutputDir}`,
      notesPath
    };
  }

  const svgStems = (await readdir(svgOutputDir))
    .filter((file) => file.toLowerCase().endsWith('.svg'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((file) => basename(file, extname(file)));
  if (svgStems.length === 0) {
    return {
      attempted: true,
      status: 'skipped',
      reason: 'svg_output has no SVG files',
      notesPath
    };
  }

  const content = await readFile(notesPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const selectedHeadings = selectSlideHeadings(lines, svgStems.length);
  if (selectedHeadings.length !== svgStems.length) {
    return {
      attempted: true,
      status: 'skipped',
      reason: `could not identify ${svgStems.length} slide headings in notes/total.md`,
      notesPath,
      svgStems
    };
  }

  const renamedHeadings: SplitNotesAutoRepair['renamedHeadings'] = [];
  for (const [index, heading] of selectedHeadings.entries()) {
    const target = svgStems[index] ?? heading.title;
    if (heading.title === target) continue;
    lines[heading.lineIndex] = `${'#'.repeat(heading.level)} ${target}`;
    renamedHeadings.push({
      line: heading.lineIndex + 1,
      from: heading.title,
      to: target
    });
  }

  if (renamedHeadings.length === 0) {
    return {
      attempted: true,
      status: 'already_aligned',
      reason: 'slide headings already match svg_output stems',
      notesPath,
      svgStems,
      renamedHeadings
    };
  }

  const backupPath = join(projectPath, 'notes', `total.md.sciforge-bak-${formatStamp(now())}`);
  await copyFile(notesPath, backupPath);
  await writeFile(notesPath, `${lines.join(newline)}${content.endsWith('\n') ? '' : newline}`, 'utf8');

  return {
    attempted: true,
    status: 'repaired_and_retried',
    notesPath,
    backupPath,
    svgStems,
    renamedHeadings
  };
}

type MarkdownHeading = {
  lineIndex: number;
  level: number;
  title: string;
};

function selectSlideHeadings(lines: string[], expectedCount: number): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  lines.forEach((line, lineIndex) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    headings.push({
      lineIndex,
      level: match[1]?.length ?? 1,
      title: match[2]?.trim() ?? ''
    });
  });

  const byLevel = new Map<number, MarkdownHeading[]>();
  for (const heading of headings) {
    byLevel.set(heading.level, [...(byLevel.get(heading.level) ?? []), heading]);
  }

  for (const level of [2, 1, 3, 4, 5, 6]) {
    const candidates = byLevel.get(level) ?? [];
    if (candidates.length === expectedCount) return candidates;
  }

  const first = headings[0];
  if (first?.level === 1) {
    const afterDeckTitle = headings.slice(1);
    if (afterDeckTitle.length === expectedCount) return afterDeckTitle;
    const firstLevelAfterTitle = afterDeckTitle[0]?.level;
    if (firstLevelAfterTitle) {
      const sameLevel = afterDeckTitle.filter((heading) => heading.level === firstLevelAfterTitle);
      if (sameLevel.length === expectedCount) return sameLevel;
    }
  }

  return [];
}

async function assertPptMasterProjectPath(
  projectPath: string,
  action: string,
  options: { requireSvgOutput?: boolean } = {}
): Promise<void> {
  assertDirectory(projectPath, 'projectPath');
  const requiredDirs = ['sources', 'notes'];
  const missingDirs = requiredDirs.filter((dir) => !existsSync(join(projectPath, dir)));
  const svgOutputDir = join(projectPath, 'svg_output');
  const hasSvgOutput = existsSync(svgOutputDir);
  const svgCount = hasSvgOutput
    ? (await readdir(svgOutputDir)).filter((file) => file.toLowerCase().endsWith('.svg')).length
    : 0;
  if (missingDirs.length === 0 && (!options.requireSvgOutput || svgCount > 0)) return;

  const candidates = await findPptMasterProjectCandidates(projectPath);
  const suffix = candidates.length > 0 ? ` Did you mean: ${candidates.join(', ')}?` : '';
  const svgReason = options.requireSvgOutput && svgCount === 0 ? ' no SVG files in svg_output' : undefined;
  const reasons = [
    missingDirs.length > 0 ? `missing ${missingDirs.join(', ')}` : undefined,
    !hasSvgOutput ? 'missing svg_output' : svgReason
  ].filter((reason): reason is string => Boolean(reason));
  throw new Error(
    `Cannot ${action}: projectPath does not look like a ppt-master deck project (${reasons.join('; ')}): ${projectPath}.${suffix}`
  );
}

async function findPptMasterProjectCandidates(root: string, maxDepth = 2): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name);
    if (
      existsSync(join(candidate, 'sources')) &&
      existsSync(join(candidate, 'notes')) &&
      existsSync(join(candidate, 'svg_output'))
    ) {
      candidates.push(candidate);
    } else if (maxDepth > 1) {
      candidates.push(...(await findPptMasterProjectCandidates(candidate, maxDepth - 1)));
    }
  }
  return candidates.slice(0, 5);
}

function fileState(path: string): { path: string; exists: boolean } {
  return { path, exists: existsSync(path) };
}

function isScientificModalityPath(path: string): boolean {
  return SCIENTIFIC_MODALITY_EXTENSIONS.test(path);
}

function isPresentationFigurePath(path: string): boolean {
  return PRESENTATION_FIGURE_EXTENSIONS.test(path) && !isScientificModalityPath(path);
}

function toProjectRelativePath(projectPath: string, assetPath: string): string {
  return relative(projectPath, assetPath).split(sep).join('/');
}

function uniqueStagedName(existingPaths: string[], sourcePath: string): string {
  const ext = extname(sourcePath);
  const stem = slugify(basename(sourcePath, ext)) || 'source';
  const digest = createHash('sha1').update(sourcePath).digest('hex').slice(0, 8);
  let candidate = `${stem}-${digest}${ext}`;
  let index = 2;
  const existing = new Set(existingPaths.map((path) => basename(path)));
  while (existing.has(candidate)) {
    candidate = `${stem}-${digest}-${index}${ext}`;
    index += 1;
  }
  return candidate;
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'sciforge-presentation';
}

function formatStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function resolveHome(value: string, homeDir: string): string {
  if (value === '~') return homeDir;
  if (value.startsWith(`~${sep}`) || value.startsWith('~/')) {
    return join(homeDir, value.slice(2));
  }
  return resolve(value);
}

function defaultPythonFor(homeDir: string): string {
  const bundledPython = join(
    homeDir,
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'python',
    'bin',
    'python3'
  );
  if (existsSync(bundledPython)) return bundledPython;
  return 'python3';
}

function stringEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function blockQuote(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export const _internals = {
  DEFAULT_SCIFORGE_STYLE_PRESET,
  PRESENTATION_FIGURE_EXTENSIONS,
  SCIENTIFIC_MODALITY_EXTENSIONS,
  conversionScriptFor,
  isPresentationFigurePath,
  renderSciForgeContext,
  resolveProjectPath,
  slugify
};
