import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  rule: string;
  message: string;
  text: string;
};

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'dist-desktop', 'build', 'coverage']);
const legacyComputerUsePublicSurface = /\b(?:computer_use\.(?:runTask|perform_local_action|fill_fields|executeBoundedOperation)|runTask|perform_local_action|fill_fields|executeBoundedOperation)\b/;
const guiCompletionToolName = /\b(?:gui\.present|gui\.ask_user|gui_present|gui_ask_user)\b/;
const guiCompletionRegistration = /\b(?:register(?:Tool|Module)?|define(?:Tool|Module)?|add(?:Tool|Module)?|create(?:Tool|Module|Mcp|Server)?|callTool)\s*\(|\b(?:name|toolName|moduleId)\s*:/i;
const retiredRuntimeGuiModuleSurface = /(?:^\s*['"]gui['"]\s*,|moduleId\s*===\s*['"]gui['"]|moduleId\s*:\s*['"]gui['"]|moduleId:\s*GUI_MODULE_ID|export\s+const\s+GUI_MODULE_ID\s*=\s*['"]gui['"])/;
const directComputerUseBypassImport = /(?:from\s+['"].*\/(?:vscode-app-module|agent-host-computer-use-act-materializer)(?:\.js)?['"]|import\s*\(\s*['"].*\/(?:vscode-app-module|agent-host-computer-use-act-materializer)(?:\.js)?['"]\s*\)|\bcreateDefaultComputerUseActMaterializer\s*\()/;
const bareOrdinaryVSCodeNativeShortcut = /\b(?:shouldRunNarrowCurrentVSCodeOrdinaryLiveDiagnostic|narrowCurrentVSCodeLiveDiagnostic|narrow\s+ordinary\s+(?:chat\s+)?(?:text|vscode|live))/i;

async function main() {
  const files = [
    ...await collectSourceFilesIfExists(join(root, 'src', 'runtime')),
    ...await collectSourceFilesIfExists(join(root, 'packages', 'backend', 'src')),
    ...await collectSourceFilesIfExists(join(root, 'packages', 'actions', 'computer-use')),
  ];
  const findings: Finding[] = [];

  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (isTestFile(rel)) continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isGuiCompletionSurfaceLine(line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-gui-completion-surface',
          message: 'Runtime/product code must not register gui.present/gui.ask_user/gui_present/gui_ask_user/moduleId=gui as a completion surface.',
          text: line.trim(),
        });
      }
      if (isRetiredRuntimeGuiModuleSurfaceLine(rel, line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-runtime-gui-module-surface',
          message: 'Runtime modules must not expose the retired gui module; GUI presentation belongs to Agent Host events, not module.invoke.',
          text: line.trim(),
        });
      }
      if (isLegacyComputerUsePublicSurfaceLine(rel, line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-legacy-computer-use-public-surface',
          message: 'Computer Use public surface must only expose bind/observe/act/run_procedure/control.',
          text: line.trim(),
        });
      }
      if (isOrdinaryRouteDirectComputerUseImport(rel, line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-ordinary-chat-direct-computer-use-import',
          message: 'Ordinary chat/native route must enter Agent Host and must not directly import VSCode app module or Computer Use act materializer.',
          text: line.trim(),
        });
      }
      if (isBareOrdinaryVSCodeNativeShortcut(rel, line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-bare-ordinary-vscode-native-shortcut',
          message: 'Bare ordinary chat text must not directly start current VSCode native live diagnostics; require Host-owned intent or refs-first Agent Host input.',
          text: line.trim(),
        });
      }
    });
  }

  findings.push(...await structuredManifestFindings());

  if (findings.length) {
    console.error('[computer-use-no-bypass] forbidden bypass surfaces found');
    for (const finding of findings) {
      console.error(`- ${finding.rule}: ${finding.file}:${finding.line} ${finding.message}`);
      console.error(`  ${finding.text}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[ok] no Computer Use bypass surfaces found: ${files.length} source files scanned.`);
}

function isGuiCompletionSurfaceLine(line: string): boolean {
  if (!guiCompletionToolName.test(line)) return false;
  return guiCompletionRegistration.test(line) || /\bmoduleId\s*:\s*['"]gui['"]/.test(line);
}

function isRetiredRuntimeGuiModuleSurfaceLine(file: string, line: string): boolean {
  if (!/^src\/runtime\/modules\/(?:dispatcher|gui-module-handler)\.ts$/.test(file)) return false;
  return retiredRuntimeGuiModuleSurface.test(line);
}

function isLegacyComputerUsePublicSurfaceLine(file: string, line: string): boolean {
  if (!/^packages\/actions\/computer-use\/(?:index|mcp)\.ts$/.test(file)) return false;
  return legacyComputerUsePublicSurface.test(line);
}

function isOrdinaryRouteDirectComputerUseImport(file: string, line: string): boolean {
  if (!/^src\/runtime\/(?:(?:codex\/(?:computer-use-native-route|codex-app-server-client|codex-runtime-server|codex-runtime-gateway))|generation-gateway|workspace-runtime-gateway|workspace-server)\.ts$/.test(file)) return false;
  return directComputerUseBypassImport.test(line);
}

function isBareOrdinaryVSCodeNativeShortcut(file: string, line: string): boolean {
  if (file !== 'src/runtime/codex/computer-use-native-route.ts') return false;
  return bareOrdinaryVSCodeNativeShortcut.test(line);
}

async function structuredManifestFindings(): Promise<Finding[]> {
  const rel = 'packages/actions/computer-use/action-provider.manifest.json';
  const text = await readTextIfExists(join(root, rel));
  if (!text) return [];
  const findings: Finding[] = [];
  const manifest = parseJsonRecord(text);
  const actionSchemaText = JSON.stringify(recordAt(manifest, 'actionSchema') ?? {});
  const hostPortsText = JSON.stringify(recordAt(manifest, 'hostPortsContract') ?? {});
  if (legacyComputerUsePublicSurface.test(actionSchemaText) || legacyComputerUsePublicSurface.test(hostPortsText)) {
    findings.push({
      file: rel,
      line: 1,
      rule: 'forbidden-legacy-computer-use-public-surface',
      message: 'Computer Use action schema and host ports contract must not expose legacy task-shaped public surface.',
      text: 'actionSchema/hostPortsContract',
    });
  }
  return findings;
}

async function collectSourceFilesIfExists(dir: string): Promise<string[]> {
  try {
    return await collectSourceFiles(dir);
  } catch {
    return [];
  }
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...await collectSourceFiles(join(dir, entry.name)));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(join(dir, entry.name));
  }
  return files;
}

function isTestFile(file: string): boolean {
  return /(?:^|\/)(?:test|tests|__tests__)\//.test(file)
    || /\.(?:test|spec)\.[cm]?[tj]sx?$/.test(file)
    || /(?:-test|-acceptance)\.[cm]?[tj]sx?$/.test(file);
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
