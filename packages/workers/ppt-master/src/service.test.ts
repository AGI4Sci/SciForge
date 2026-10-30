import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPptMasterService, type CommandResult } from './service.js';

function okCommand(command: string, args: string[], cwd?: string): CommandResult {
  return {
    command,
    args,
    cwd,
    exitCode: 0,
    signal: null,
    stdout: 'ok',
    stderr: '',
    timedOut: false
  };
}

async function fakeSkillDir(root: string): Promise<string> {
  const skill = join(root, 'ppt-master');
  const scripts = [
    'scripts/project_manager.py',
    'scripts/source_to_md/pdf_to_md.py',
    'scripts/source_to_md/doc_to_md.py',
    'scripts/source_to_md/excel_to_md.py',
    'scripts/source_to_md/ppt_to_md.py',
    'scripts/source_to_md/web_to_md.py',
    'scripts/total_md_split.py',
    'scripts/svg_quality_checker.py',
    'scripts/finalize_svg.py',
    'scripts/svg_to_pptx.py'
  ];
  for (const script of scripts) {
    const path = join(skill, script);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, '#!/usr/bin/env python3\n', 'utf8');
  }
  return skill;
}

test('status reports missing skill directory without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-status-'));
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: join(root, 'missing'), PPT_MASTER_PYTHON: 'python' }
  });

  const status = await service.status();

  assert.equal(status.ok, false);
  assert.equal(status.skillDirExists, false);
  assert.equal(status.python, 'python');
  assert.ok(status.missingScripts.includes('projectManager'));
});

test('status defaults to bundled Codex Python when available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-python-'));
  const skillDir = await fakeSkillDir(root);
  const bundledPython = join(
    root,
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'python',
    'bin',
    'python3'
  );
  await mkdir(join(bundledPython, '..'), { recursive: true });
  await writeFile(bundledPython, '#!/usr/bin/env python3\n', 'utf8');
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir },
    homeDir: root
  });

  const status = await service.status();

  assert.equal(status.ok, true);
  assert.equal(status.python, bundledPython);
});

test('init project returns the actual path created by project_manager', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-init-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  const actualProjectPath = join(workspace, 'presentations', 'demo_ppt169_20260625');
  await mkdir(workspace, { recursive: true });
  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    runCommand: async (command, args, options) => {
      const result = {
        ...okCommand(command, args, options.cwd),
        stdout: calls.length === 0 ? `Project created: ${actualProjectPath}\n[OK] Project initialized: ${actualProjectPath}\n` : 'ok\n'
      };
      calls.push(result);
      return result;
    }
  });

  const result = await service.initProject({
    workspaceRoot: workspace,
    projectPath: 'presentations/demo',
    sourcePaths: [join(workspace, 'source.md')]
  });

  assert.equal(result.projectPath, actualProjectPath);
  assert.equal(result.requestedProjectPath, join(workspace, 'presentations', 'demo'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.args[2], actualProjectPath);
});

test('init project rejects project paths and source paths outside workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-init-boundary-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    runCommand: async (command, args, options) => {
      const result = okCommand(command, args, options.cwd);
      calls.push(result);
      return result;
    }
  });

  await assert.rejects(
    () => service.initProject({
      workspaceRoot: workspace,
      projectPath: '../outside/deck'
    }),
    /projectPath must stay inside workspaceRoot/
  );
  await assert.rejects(
    () => service.initProject({
      workspaceRoot: workspace,
      projectPath: 'presentations/demo',
      sourcePaths: [join(root, 'outside-source.md')]
    }),
    /sourcePaths must stay inside workspaceRoot/
  );
  assert.equal(calls.length, 0);
});

test('sciforge intake stages document sources but keeps scientific refs as evidence-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-intake-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'papers'), { recursive: true });
  await writeFile(join(workspace, 'papers', 'paper.pdf'), 'pdf bytes', 'utf8');
  await writeFile(join(workspace, 'papers', 'protein.fasta'), '>seq\nMKT', 'utf8');

  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    now: () => new Date('2026-06-21T00:00:00.000Z'),
    runCommand: async (command, args, options) => {
      const result = okCommand(command, args, options.cwd);
      calls.push(result);
      return result;
    }
  });

  const result = await service.sciforgeIntake({
    workspaceRoot: workspace,
    deckSlug: 'Protein Deck',
    title: 'Protein Deck',
    sourceFiles: [
      { path: 'papers/paper.pdf', title: 'paper' },
      { path: 'papers/protein.fasta', title: 'protein', modelRouterObject: true }
    ],
    quotedSelections: [{ sourceTitle: 'paper', location: 'p1', text: 'Important result.' }],
    modelRouterEvidence: [{ source: 'protein.fasta', modality: 'protein', model: 'esm2', text: 'Expert evidence.' }]
  });

  assert.equal(result.importedSourceCount, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.args.join(' ') ?? '', /project_manager\.py import-sources/);
  assert.ok(calls[0]?.args.includes('--move'));
  assert.ok((calls[0]?.args ?? []).some((arg) => arg.endsWith('.pdf')));
  assert.ok(!(calls[0]?.args ?? []).some((arg) => arg.endsWith('.fasta')));

  const context = await readFile(result.contextPath, 'utf8');
  assert.match(context, /Model Router Scientific Evidence/);
  assert.match(context, /Expert evidence/);
  assert.match(context, /model-router-evidence-only/);

  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
    sources: Array<{ handling: string }>;
  };
  assert.deepEqual(manifest.sources.map((source) => source.handling), [
    'staged-for-import',
    'model-router-evidence-only'
  ]);
});

test('sciforge intake copies existing figures as presentation assets without importing or moving originals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-figures-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'figures'), { recursive: true });
  const figureSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#ffffff"/></svg>\n';
  await writeFile(join(workspace, 'figures', 'result.svg'), figureSvg, 'utf8');

  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    now: () => new Date('2026-06-21T00:00:00.000Z'),
    runCommand: async (command, args, options) => {
      const result = okCommand(command, args, options.cwd);
      calls.push(result);
      return result;
    }
  });

  const result = await service.sciforgeIntake({
    workspaceRoot: workspace,
    deckSlug: 'Figure Deck',
    figures: [{
      path: 'figures/result.svg',
      title: 'Dose response',
      caption: 'Existing SciForge figure used as a presentation asset.',
      source: 'SciForge DataFigure Engine',
      evidenceIds: ['ev-plot-1'],
      altText: 'Line chart showing increased response.',
      kind: 'line-chart'
    }],
    modelRouterEvidence: [{ source: 'ev-plot-1', modality: 'plot', text: 'The plotted trend increases with dose.' }]
  });

  assert.equal(result.importedSourceCount, 0);
  assert.equal(result.figureAssetCount, 1);
  assert.equal(calls.length, 0);
  assert.equal(await readFile(join(workspace, 'figures', 'result.svg'), 'utf8'), figureSvg);
  assert.equal(await readFile(result.figures[0]?.assetPath ?? '', 'utf8'), figureSvg);
  assert.equal(await readFile(result.figures[0]?.stagedPath ?? '', 'utf8'), figureSvg);
  assert.match(result.figures[0]?.projectRelativePath ?? '', /^images\/sciforge_figures\/result-/);

  const context = await readFile(result.contextPath, 'utf8');
  assert.match(context, /Figure Catalog/);
  assert.match(context, /Dose response/);
  assert.match(context, /ev-plot-1/);

  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
    schemaVersion: string;
    stylePreset: string;
    figures: Array<{ handling: string; projectRelativePath: string; evidenceIds: string[] }>;
  };
  assert.equal(manifest.schemaVersion, 'sciforge.ppt-master-intake.v2');
  assert.equal(manifest.stylePreset, 'auto');
  assert.equal(manifest.figures[0]?.handling, 'presentation-figure-asset');
  assert.deepEqual(manifest.figures[0]?.evidenceIds, ['ev-plot-1']);
  assert.match(manifest.figures[0]?.projectRelativePath ?? '', /^images\/sciforge_figures\/result-/);
});

test('sciforge intake records sciforge research style only when explicitly selected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-style-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    now: () => new Date('2026-06-21T00:00:00.000Z')
  });

  const result = await service.sciforgeIntake({
    workspaceRoot: workspace,
    deckSlug: 'Styled Deck',
    stylePreset: 'sciforge_research'
  });

  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
    stylePreset: string;
    uiKit: { selectedPreset: string; availablePresets: string[] };
  };
  assert.equal(manifest.stylePreset, 'sciforge_research');
  assert.equal(manifest.uiKit.selectedPreset, 'sciforge_research');
  assert.deepEqual(manifest.uiKit.availablePresets, ['sciforge_research']);
});

test('sciforge intake rejects raw scientific files passed as figures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-raw-figure-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'figures'), { recursive: true });
  await writeFile(join(workspace, 'figures', 'protein.fasta'), '>seq\nMKT', 'utf8');
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' }
  });

  await assert.rejects(
    () => service.sciforgeIntake({
      workspaceRoot: workspace,
      deckSlug: 'Bad Figure Deck',
      figures: [{ path: 'figures/protein.fasta', title: 'not a figure' }]
    }),
    /presentation asset/
  );
});

test('sciforge intake rejects source files outside workspace before importing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-intake-boundary-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    runCommand: async (command, args, options) => {
      const result = okCommand(command, args, options.cwd);
      calls.push(result);
      return result;
    }
  });

  await assert.rejects(
    () => service.sciforgeIntake({
      workspaceRoot: workspace,
      deckSlug: 'Boundary Deck',
      sourceFiles: [{ path: join(root, 'outside-paper.pdf'), title: 'outside' }]
    }),
    /source\.path must stay inside workspaceRoot/
  );
  assert.equal(calls.length, 0);
});

test('post-processing tools run ppt-master scripts one stage at a time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-run-'));
  const skillDir = await fakeSkillDir(root);
  const projectPath = join(root, 'project');
  await mkdir(join(projectPath, 'sources'), { recursive: true });
  await mkdir(join(projectPath, 'notes'), { recursive: true });
  await mkdir(join(projectPath, 'svg_output'), { recursive: true });
  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    workspaceRoot: root,
    runCommand: async (command, args, options) => {
      const result = okCommand(command, args, options.cwd);
      calls.push(result);
      return result;
    }
  });

  await service.splitNotes({ projectPath });
  await service.finalizeSvg({ projectPath });
  await service.exportPptx({ projectPath, transition: 'fade', animationTrigger: 'after-previous' });

  assert.equal(calls.length, 3);
  assert.ok(calls[0]?.args[0]?.endsWith('total_md_split.py'));
  assert.ok(calls[1]?.args[0]?.endsWith('finalize_svg.py'));
  assert.ok(calls[2]?.args[0]?.endsWith('svg_to_pptx.py'));
  assert.deepEqual(calls[2]?.args.slice(-4), ['-t', 'fade', '--animation-trigger', 'after-previous']);
});

test('split notes repairs slide headings to match generated SVG stems before retrying', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-split-repair-'));
  const skillDir = await fakeSkillDir(root);
  const projectPath = join(root, 'project');
  await mkdir(join(projectPath, 'sources'), { recursive: true });
  await mkdir(join(projectPath, 'notes'), { recursive: true });
  await mkdir(join(projectPath, 'svg_output'), { recursive: true });
  await writeFile(join(projectPath, 'svg_output', 'P1_封面.svg'), '<svg></svg>\n', 'utf8');
  await writeFile(join(projectPath, 'svg_output', 'P2_Q1Q4_总览.svg'), '<svg></svg>\n', 'utf8');
  await writeFile(join(projectPath, 'svg_output', 'P3_季度趋势分析.svg'), '<svg></svg>\n', 'utf8');
  await writeFile(join(projectPath, 'notes', 'total.md'), [
    '# 2024年度财务数据概览',
    '',
    '## 封面',
    'cover notes',
    '',
    '## Q1-Q4 财务数据总览',
    'overview notes',
    '',
    '## 季度趋势分析',
    'trend notes',
    ''
  ].join('\n'), 'utf8');

  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    workspaceRoot: root,
    now: () => new Date('2026-06-22T10:00:00.000Z'),
    runCommand: async (command, args, options) => {
      const result = calls.length === 0
        ? {
            ...okCommand(command, args, options.cwd),
            exitCode: 1,
            stdout: 'Error: SVG files and notes do not match\n  Missing notes: P2_Q1Q4_总览\n'
          }
        : okCommand(command, args, options.cwd);
      calls.push(result);
      return result;
    }
  });

  const result = await service.splitNotes({ projectPath });
  const repairedNotes = await readFile(join(projectPath, 'notes', 'total.md'), 'utf8');

  assert.equal(calls.length, 2);
  assert.equal(result.exitCode, 0);
  assert.equal(result.autoRepair?.status, 'repaired_and_retried');
  assert.equal(result.autoRepair?.renamedHeadings?.length, 3);
  assert.match(repairedNotes, /## P1_封面/);
  assert.match(repairedNotes, /## P2_Q1Q4_总览/);
  assert.match(repairedNotes, /## P3_季度趋势分析/);
  assert.ok(result.autoRepair?.backupPath?.endsWith('total.md.sciforge-bak-20260622T100000Z'));
});

test('controlled post-processing tools reject project paths outside configured workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-post-boundary-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  const outsideProject = join(root, 'outside-project');
  await mkdir(workspace, { recursive: true });
  const calls: CommandResult[] = [];
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' },
    workspaceRoot: workspace,
    runCommand: async (command, args, options) => {
      const result = okCommand(command, args, options.cwd);
      calls.push(result);
      return result;
    }
  });

  await assert.rejects(
    () => service.splitNotes({ projectPath: outsideProject }),
    /projectPath must stay inside workspaceRoot/
  );
  await assert.rejects(
    () => service.finalizeSvg({ projectPath: '../outside-project' }),
    /projectPath must stay inside workspaceRoot/
  );
  await assert.rejects(
    () => service.exportPptx({ projectPath: outsideProject }),
    /projectPath must stay inside workspaceRoot/
  );
  assert.equal(calls.length, 0);
});

test('post-processing rejects workspace root when a nested deck project should be used', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-master-mcp-wrong-project-'));
  const skillDir = await fakeSkillDir(root);
  const workspace = join(root, 'workspace');
  const deck = join(workspace, 'presentations', 'demo');
  await mkdir(join(deck, 'sources'), { recursive: true });
  await mkdir(join(deck, 'notes'), { recursive: true });
  await mkdir(join(deck, 'svg_output'), { recursive: true });
  await writeFile(join(deck, 'svg_output', 'slide_01.svg'), '<svg></svg>\n', 'utf8');
  const service = createPptMasterService({
    env: { PPT_MASTER_SKILL_DIR: skillDir, PPT_MASTER_PYTHON: 'python3' }
  });

  await assert.rejects(
    () => service.qualityCheck({ projectPath: workspace }),
    new RegExp(`Cannot quality check:.*${deck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  );
});
