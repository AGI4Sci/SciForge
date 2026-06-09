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
const vscodeAppModuleForbiddenDesktopImport = /\bfrom\s+['"][^'"]*(?:packages\/actions\/computer-use\/(?:index|mcp)|src\/runtime\/computer-use\/(?:executor|independent-input-adapter|package-bridge-execute-port)|runtime\/computer-use\/(?:executor|independent-input-adapter|package-bridge-execute-port)|src\/desktop\/|\/desktop\/|agent-host-[^'"]*computer-use[^'"]*materializer|window-action-computer-use-primitive-ports)[^'"]*['"]|import\s*\(\s*['"][^'"]*(?:packages\/actions\/computer-use\/(?:index|mcp)|src\/runtime\/computer-use\/(?:executor|independent-input-adapter|package-bridge-execute-port)|runtime\/computer-use\/(?:executor|independent-input-adapter|package-bridge-execute-port)|src\/desktop\/|\/desktop\/|agent-host-[^'"]*computer-use[^'"]*materializer|window-action-computer-use-primitive-ports)[^'"]*['"]\s*\)/;
const vscodeAppModuleForbiddenDesktopCall = /\b(?:service\.invoke|createComputerUsePrimitiveService|createComputerUseMcpAdapter|createDefaultComputerUseActMaterializer|executeGenericDesktopAction|executeIndependentInputAdapterAction|desktopController\.[A-Za-z_$][\w$]*|systemInput\.[A-Za-z_$][\w$]*|runCommand\s*\(\s*['"](?:osascript|open|screencapture)['"]|execFile\s*\(\s*['"](?:osascript|open|screencapture)['"]|spawn\s*\(\s*['"](?:osascript|open|screencapture)['"]|CGEvent|System Events)\b/;
const bareOrdinaryVSCodeNativeShortcut = /\b(?:shouldRunNarrowCurrentVSCodeOrdinaryLiveDiagnostic|narrowCurrentVSCodeLiveDiagnostic|narrow\s+ordinary\s+(?:chat\s+)?(?:text|vscode|live))/i;
const ordinaryTextField = /\b(?:message|commandText|intentText|prompt|paletteLabel|commandId)\b/;
const vscodeOperationLiteral = /['"](?:focus-editor|read-visible-text|editor-scope|move-cursor|insert-draft|replace-selection|save-current-file|bulk-replace|cross-file-modify|undo-last-action|redo-last-action|show-problems|read-diagnostics|focus-terminal|send-terminal-text|observe-terminal|submit-terminal-command|interrupt-terminal-command|clear-terminal|focus-editor-from-terminal|open-command-palette|send-command-palette-query|observe-command-palette-items|select-command-palette-item|close-command-palette)['"]/;
const vscodeOperationTextInferenceHelper = /\b(?:lowRisk[A-Za-z0-9_$]*OperationFromText|[A-Za-z0-9_$]*(?:VSCode|Vscode|vscode|CoWork|Cowork)[A-Za-z0-9_$]*(?:Operation|operation)[A-Za-z0-9_$]*(?:From|For|By)[A-Za-z0-9_$]*(?:Text|Prompt|Message|CommandText|IntentText)|[A-Za-z0-9_$]*(?:Text|Prompt|Message|CommandText|IntentText)[A-Za-z0-9_$]*(?:To|As|Into)[A-Za-z0-9_$]*(?:VSCode|Vscode|vscode|CoWork|Cowork)[A-Za-z0-9_$]*(?:Operation|operation))\b/;
const genericOperationTextInferenceHelper = /\b[A-Za-z0-9_$]*(?:Operation|operation)[A-Za-z0-9_$]*(?:From|For|By)[A-Za-z0-9_$]*(?:Text|Prompt|Message|CommandText|IntentText)\b/;
const vscodeLiveDiagnosticTextInference = /\b(?:liveDiagnostic|live[-\s]?diagnostic|currentVSCodeCoWorkLiveDiagnosticRunner|tryRunCurrentVSCodeCoWorkLiveDiagnostic)\b/i;
const uiNativeFinalAnswerBypass = /\b(?:nativeCodexMessage|runtimeDoneNativeMessage|withNativeCodexMessageRuntimeResult)\b|codex\.native-message/;
const publicProjectionSurfaceFiles = new Set([
  'src/runtime/codex/codex-app-server-adapter.ts',
  'src/runtime/codex/computer-use-native-route.ts',
  'src/runtime/codex/codex-runtime-gateway.ts',
  'src/runtime/codex/agent-host-computer-use-app-module-materializer.ts',
  'src/runtime/codex/computer-use-app-module-registry.ts',
  'src/runtime/computer-use/host-adapter.ts',
  'src/runtime/computer-use/package-bridge-presentation.ts',
  'packages/actions/computer-use/index.ts',
]);
const publicProjectionActivation = /\b(?:emitWorkspaceRuntimeEvent|publicHostOwnedRuntimeEvent|workspaceRuntimeEvent|doneEvent|failedEvent|runtimeCodexMissingFinalAnswerPayload|publicRuntimeMode|sanitizePublicEvent|publicEventHasForbiddenRaw|validateComputerUseAppModuleReadiness|readinessArtifact|readinessResult|computerUseResultToTuiHostActions|computerUsePresentationSummary|approvalRequestFromResult|attachPackageResultHostActions|primitiveModuleResult|moduleResult|objectReferences|payload\.logs|computer-use\.tui-host-actions)\b/;
const publicEventSanitizerImport = /@sciforge-ui\/runtime-contract\/public-event-sanitizer/;
const alwaysUnsafePublicEventPayloadLiteral = /(?:\b(?:rawScreenshotPath|rawScreenshotBase64|screenshotBase64|providerPayload|rawProviderPayload|rawVisibleText|rawSelectedText|rawCommand|rawPath)\b\s*:|data:image\/|;base64,)/i;
const guardedUnsafePublicEventPayloadLiteral = /\b(?:commandText|terminalCommand|workspacePath|filePath|targetPath|stdout|stderr|requestBody|responseBody)\b\s*:/i;
const allowedComputerUsePrimitiveNames = new Set(['bind', 'observe', 'act', 'run_procedure', 'control']);
const forbiddenComputerUsePublicIntentNames = new Set([
  'runTask',
  'perform_local_action',
  'fill_fields',
  'executeBoundedOperation',
  'complete',
  'finalAnswer',
  'plan',
  'locate',
  'verify',
]);
const computerUseIntentLiteral = /\bcomputer_use\.([A-Za-z0-9_-]+)\b/g;
const computerUseInputSchemaLiteral = /\bsciforge\.computer-use\.([a-z0-9_-]+)-input\.v\d+\b/g;
const forbiddenPublicIntentLiteral = /['"](?:runTask|perform_local_action|fill_fields|executeBoundedOperation|complete|finalAnswer|plan|locate|verify)['"]/g;

async function main() {
  const files = [
    ...await collectSourceFilesIfExists(join(root, 'src', 'runtime')),
    ...await collectSourceFilesIfExists(join(root, 'src', 'ui', 'src', 'api', 'sciforgeToolsClient')),
    ...await collectSourceFilesIfExists(join(root, 'src', 'ui', 'src', 'api', 'agentClient')),
    ...await collectSourceFilesIfExists(join(root, 'packages', 'backend', 'src')),
    ...await collectSourceFilesIfExists(join(root, 'packages', 'actions', 'computer-use')),
  ];
  const findings: Finding[] = [];

  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (isTestFile(rel)) continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    findings.push(...fileLevelBypassFindings(rel, text));
    if (isActivePublicProjectionSurface(rel, text) && !hasPublicProjectionGuard(rel, text)) {
      findings.push({
        file: rel,
        line: 1,
        rule: 'missing-public-event-sanitizer',
        message: 'Computer Use public projection surfaces must route public events through the shared public-event sanitizer.',
        text: 'missing @sciforge-ui/runtime-contract/public-event-sanitizer import',
      });
    }
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
      if (isVSCodeOperationTextInferenceLine(rel, line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-vscode-operation-text-inference',
          message: 'Ordinary chat/native route must not infer VSCode operations or live diagnostics from message/commandText/intentText/prompt text; require a structured Host operation ref.',
          text: line.trim(),
        });
      }
      if (isUiNativeFinalAnswerBypassLine(rel, line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-ui-native-final-answer-bypass',
          message: 'UI/runtime projection must not synthesize final answers from native messages; require Host-owned FinalAnswerEnvelope evidence.',
          text: line.trim(),
        });
      }
      if (isUnsafePublicEventPayloadLine(rel, text, line)) {
        findings.push({
          file: rel,
          line: index + 1,
          rule: 'forbidden-public-event-raw-payload',
          message: 'Computer Use public projection surfaces must not expose raw screenshot paths, data URLs, raw commands, raw paths, provider payloads, or base64 bodies.',
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

function fileLevelBypassFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  findings.push(...computerUsePublicPrimitiveSurfaceFindings(file, text));
  findings.push(...computerUseMcpAdapterFindings(file, text));
  findings.push(...computerUsePrimitiveServiceGuardFindings(file, text));
  findings.push(...sharedSystemInputSourceClaimFindings(file, text));
  findings.push(...vscodeAppModuleDirectDesktopFindings(file, text));
  if (file === 'src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts') {
    const structuredDone = sectionBetween(text, 'function withStructuredRuntimeDoneProjection', 'function withGuiAskUserRuntimeResult');
    if (structuredDone && (/\bvisibleAnswer\s*:\s*{[\s\S]*?\btext\s*:/.test(structuredDone) || unsafeMessageProjection(structuredDone))) {
      findings.push({
        file,
        line: lineNumberForIndex(text, text.indexOf(structuredDone)),
        rule: 'forbidden-structured-runtime-visible-answer-text',
        message: 'Structured runtime done projection may expose artifact refs, uiManifest refs, and audit refs, but must not project local message text as a visible answer.',
        text: 'withStructuredRuntimeDoneProjection',
      });
    }
    for (const [start, end] of [
      ['function withGuiPresentRuntimeResult', 'function guiPresentVerificationState'],
      ['function withGuiAskUserRuntimeResult', 'function withHostFinalAnswerRuntimeResult'],
    ] as const) {
      const section = sectionBetween(text, start, end);
      if (section && /\bvisibleAnswer\s*:\s*{[\s\S]*?\btext\s*:/.test(section)) {
        findings.push({
          file,
          line: lineNumberForIndex(text, text.indexOf(section)),
          rule: 'forbidden-gui-projection-visible-answer-text',
          message: 'GUI projection may carry metadata, artifact refs, and confirmation refs, but must not project GUI text as a visible final answer.',
          text: start,
        });
      }
    }
  }
  if (file === 'src/ui/src/api/sciforgeToolsClient/runtimeGuiPresentation.ts'
    && /startsWith\(\s*['"]gui\.(?:present|ask_user):['"]\s*\)[\s\S]{0,1200}\bliveAcceptanceEligible\s*:\s*true\b/.test(text)) {
    findings.push({
      file,
      line: lineNumberForIndex(text, text.search(/startsWith\(\s*['"]gui\.(?:present|ask_user):['"]\s*\)/)),
      rule: 'forbidden-gui-projection-live-acceptance',
      message: 'GUI presentation and GUI confirmation metadata must not be marked live-acceptance eligible; only Host-owned final-answer envelopes may do that.',
      text: 'gui.present/gui.ask_user liveAcceptanceEligible',
    });
  }
  if (file === 'src/ui/src/api/agentClient/responseNormalization.ts'
    && /\bfunction\s+projectionVisibleAnswer\b/.test(text)
    && !/\blegacyGuiOrComputerUseProjectionSource\b/.test(text)) {
    findings.push({
      file,
      line: lineNumberForIndex(text, text.search(/\bfunction\s+projectionVisibleAnswer\b/)),
      rule: 'missing-legacy-gui-projection-fail-closed',
      message: 'Response normalization must fail closed for legacy GUI and Computer Use projection text unless it is backed by a trusted Host final-answer envelope.',
      text: 'projectionVisibleAnswer',
    });
  }
  return findings;
}

function vscodeAppModuleDirectDesktopFindings(file: string, text: string): Finding[] {
  if (!isVSCodeAppModuleSource(file)) return [];
  const findings: Finding[] = [];
  for (const pattern of [vscodeAppModuleForbiddenDesktopImport, vscodeAppModuleForbiddenDesktopCall]) {
    const match = pattern.exec(text);
    if (match) {
      findings.push({
        file,
        line: lineNumberForIndex(text, match.index),
        rule: 'forbidden-vscode-app-module-direct-desktop-access',
        message: 'VSCode app module must only return Host readiness/evidence refs and must not import or call Computer Use executors, MCP adapters, desktop controllers, or shared system input directly.',
        text: lineTextAtIndex(text, match.index),
      });
    }
  }
  return findings;
}

function computerUsePublicPrimitiveSurfaceFindings(file: string, text: string): Finding[] {
  if (!isComputerUsePackagePublicSurface(file)) return [];
  const findings: Finding[] = [];
  scanComputerUsePrimitiveStrings(file, text, findings);
  scanForbiddenPublicIntentNames(file, text, findings);
  return findings;
}

function scanComputerUsePrimitiveStrings(file: string, text: string, findings: Finding[]): void {
  for (const pattern of [computerUseIntentLiteral, computerUseInputSchemaLiteral]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const primitive = match[1];
      if (isAllowedComputerUsePrimitiveName(primitive)) continue;
      findings.push({
        file,
        line: lineNumberForIndex(text, match.index),
        rule: 'forbidden-computer-use-public-primitive-surface',
        message: 'Computer Use public primitive surface must only expose bind/observe/act/run_procedure/control.',
        text: lineTextAtIndex(text, match.index),
      });
    }
  }
}

function scanForbiddenPublicIntentNames(file: string, text: string, findings: Finding[]): void {
  forbiddenPublicIntentLiteral.lastIndex = 0;
  for (let match = forbiddenPublicIntentLiteral.exec(text); match; match = forbiddenPublicIntentLiteral.exec(text)) {
    if (!isLikelyComputerUsePublicSurfaceContext(text, match.index)) continue;
    findings.push({
      file,
      line: lineNumberForIndex(text, match.index),
      rule: 'forbidden-computer-use-public-primitive-surface',
      message: 'Computer Use public primitive surface must not expose task, completion, planning, locating, or verification intents.',
      text: lineTextAtIndex(text, match.index),
    });
  }
}

function computerUseMcpAdapterFindings(file: string, text: string): Finding[] {
  if (!isComputerUseMcpAdapterFile(file) || !/\bcreateComputerUseMcpAdapter\b/.test(text)) return [];
  const findings: Finding[] = [];
  const adapterSection = sectionFrom(text, 'createComputerUseMcpAdapter');
  if (!/\bservice\.invoke\s*\(/.test(adapterSection)) {
    findings.push({
      file,
      line: lineNumberForIndex(text, text.indexOf('createComputerUseMcpAdapter')),
      rule: 'missing-computer-use-mcp-service-invoke',
      message: 'Computer Use MCP adapter callTool must delegate primitive calls through service.invoke so shared primitive sanitization and raw detection run.',
      text: 'createComputerUseMcpAdapter',
    });
  }
  const callToolStart = adapterSection.search(/\bcallTool\b/);
  const callToolSection = callToolStart >= 0 ? adapterSection.slice(callToolStart, callToolStart + 2500) : '';
  if (/\bmoduleResult\s*\(/.test(callToolSection) && /\breturn\s+(?:moduleResult\s*\(|[A-Za-z_$][\w$]*moduleResult[A-Za-z_$\w$]*\b)/.test(callToolSection)) {
    findings.push({
      file,
      line: lineNumberForIndex(text, text.indexOf(callToolSection)),
      rule: 'forbidden-computer-use-mcp-direct-module-result',
      message: 'Computer Use MCP adapter callTool must not build or return primitive moduleResult directly; delegate through service.invoke.',
      text: 'callTool moduleResult',
    });
  }
  return findings;
}

function computerUsePrimitiveServiceGuardFindings(file: string, text: string): Finding[] {
  if (!isComputerUseIndexFile(file)) return [];
  if (!/\b(?:createComputerUsePrimitiveService|primitiveModuleResult)\b/.test(text)) return [];
  if (/\bsanitizePublicEvent\b/.test(text) && /\b(?:publicEventHasForbiddenRaw|primitivePortResultHasForbiddenRaw)\b/.test(text)) return [];
  return [{
    file,
    line: 1,
    rule: 'missing-computer-use-primitive-sanitizer-path',
    message: 'Computer Use primitive service must keep public outputs on the shared sanitizer and forbidden raw detector path.',
    text: 'createComputerUsePrimitiveService/primitiveModuleResult',
  }];
}

function sharedSystemInputSourceClaimFindings(file: string, text: string): Finding[] {
  if (!isSharedSystemInputClaimSource(file, text)) return [];
  const findings: Finding[] = [];
  const pattern = /\b(?:sharedSystemInput|sharedSystemInputUsed)\s*:\s*true\b/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const claim = objectLikeWindow(text, match.index);
    if (sharedSystemInputClaimIsDiagnosticOnly(claim)) continue;
    findings.push({
      file,
      line: lineNumberForIndex(text, match.index),
      rule: 'forbidden-shared-system-input-product-ready',
      message: 'shared-system-input claims must be maturity=live-diagnostic and productReady=false.',
      text: lineTextAtIndex(text, match.index),
    });
  }
  return findings;
}

function isComputerUsePackagePublicSurface(file: string): boolean {
  return /^packages\/actions\/computer-use\/(?:index|mcp)\.[cm]?[tj]s$/.test(file);
}

function isComputerUseMcpAdapterFile(file: string): boolean {
  return /^packages\/actions\/computer-use\/mcp\.[cm]?[tj]s$/.test(file);
}

function isComputerUseIndexFile(file: string): boolean {
  return /^packages\/actions\/computer-use\/index\.[cm]?[tj]s$/.test(file);
}

function isVSCodeAppModuleSource(file: string): boolean {
  return /^src\/runtime\/codex\/vscode-app-module(?:-[^/]*)?\.[cm]?[tj]sx?$/.test(file);
}

function isAllowedComputerUsePrimitiveName(value: string | undefined): boolean {
  if (!value) return false;
  return allowedComputerUsePrimitiveNames.has(normalizeComputerUsePrimitiveName(value));
}

function normalizeComputerUsePrimitiveName(value: string): string {
  return value.replaceAll('-', '_');
}

function isLikelyComputerUsePublicSurfaceContext(text: string, index: number): boolean {
  const line = lineTextAtIndex(text, index);
  if (/\b(?:COMPUTER_USE_PRIMITIVE|computerUseMcpTools|name|toolName|intent|requiredPorts|forbiddenPorts|primitive|mcpTools)\b/.test(line)) return true;
  const context = text.slice(Math.max(0, index - 500), Math.min(text.length, index + 500));
  return /\b(?:COMPUTER_USE_PRIMITIVE|computerUseMcpTools|mcpTools|hostPortsContract|actionSchema|inputShape|requiredPorts|forbiddenPorts)\b/.test(context);
}

function isSharedSystemInputClaimSource(file: string, text: string): boolean {
  if (!/\b(?:sharedSystemInput|sharedSystemInputUsed)\s*:\s*true\b/.test(text)) return false;
  if (!/^packages\/actions\/computer-use\/.*\.[cm]?[tj]sx?$/.test(file)) {
    return false;
  }
  return /\b(?:maturity|productReady)\s*:/.test(text) || /(?:manifest|capability|acceptance|diagnostic|readiness)/i.test(file);
}

function sharedSystemInputClaimIsDiagnosticOnly(text: string): boolean {
  return /\bmaturity\s*:\s*['"]live-diagnostic['"]/.test(text)
    && /\bproductReady\s*:\s*false\b/.test(text);
}

function sectionFrom(text: string, needle: string): string {
  const start = text.indexOf(needle);
  return start < 0 ? '' : text.slice(start);
}

function objectLikeWindow(text: string, index: number): string {
  const start = text.lastIndexOf('{', index);
  const end = text.indexOf('}', index);
  if (start >= 0 && end >= 0 && end - start <= 2000) return text.slice(start, end + 1);
  return text.slice(Math.max(0, index - 800), Math.min(text.length, index + 800));
}

function lineTextAtIndex(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const lineEnd = text.indexOf('\n', index);
  return text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
}

function sectionBetween(text: string, startNeedle: string, endNeedle: string): string | undefined {
  const start = text.indexOf(startNeedle);
  if (start < 0) return undefined;
  const end = text.indexOf(endNeedle, start + startNeedle.length);
  return text.slice(start, end < 0 ? undefined : end);
}

function lineNumberForIndex(text: string, index: number): number {
  if (index < 0) return 1;
  return text.slice(0, index).split(/\r?\n/).length;
}

function unsafeMessageProjection(section: string): boolean {
  return section.split(/\r?\n/).some((line) => {
    const code = line.replace(/\/\/.*$/, '').trim();
    if (/\{\s*message\s*[,}]/.test(code) || /^message\s*,/.test(code)) return true;
    const match = code.match(/\bmessage\s*:\s*([^,}]+)/);
    if (!match) return false;
    return !/^(?:undefined|null)\b/.test(match[1]?.trim() ?? '');
  });
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

function isVSCodeOperationTextInferenceLine(file: string, line: string): boolean {
  if (!isOrdinaryChatOrNativeRouteSurface(file)) return false;
  const code = line.replace(/\/\/.*$/, '');
  if (vscodeOperationTextInferenceHelper.test(code)) return true;
  if (genericOperationTextInferenceHelper.test(code) && (isVSCodeCoWorkRouteSurface(file) || vscodeOperationLiteral.test(code))) return true;
  if (!ordinaryTextField.test(code)) return false;
  if (isVSCodeCoWorkLiveDiagnosticProducerSurface(file)
    && /\b(?:operation|vscodeCoWorkOperation)\s*[:=]/i.test(code)) return true;
  if (vscodeOperationLiteral.test(code) && /\b(?:operation|vscodeCoWork|VSCode|Vscode|vscode)\b/.test(code)) return true;
  if (vscodeLiveDiagnosticTextInference.test(code) && /\b(?:infer|derive|detect|guess|parse|select|shouldRun|run)\b/i.test(code)) return true;
  if (/\b(?:operation|vscodeCoWorkOperation)\s*[:=]/i.test(code) && /\b(?:String|trim|match|test|includes|toLowerCase|toUpperCase)\s*\(/.test(code)) return true;
  return false;
}

function isOrdinaryChatOrNativeRouteSurface(file: string): boolean {
  return /^src\/runtime\/codex\/.*(?:route|chat|gateway|server|bridge).*\.ts$/.test(file)
    || /^src\/runtime\/(?:generation-gateway|workspace-runtime-gateway|workspace-server)\.ts$/.test(file)
    || isVSCodeCoWorkLiveDiagnosticProducerSurface(file);
}

function isVSCodeCoWorkRouteSurface(file: string): boolean {
  return file === 'src/runtime/codex/computer-use-native-route.ts'
    || /(?:^|\/)vscode-cowork-.*(?:route|chat|bridge).*\.ts$/.test(file);
}

function isVSCodeCoWorkLiveDiagnosticProducerSurface(file: string): boolean {
  return /^src\/runtime\/codex\/agent-host-vscode-cowork-.*live-diagnostic\.[cm]?[tj]s$/.test(file);
}

function isUiNativeFinalAnswerBypassLine(file: string, line: string): boolean {
  if (!/^src\/ui\/src\/api\/sciforgeToolsClient\/.*\.ts$/.test(file)) return false;
  return uiNativeFinalAnswerBypass.test(line.replace(/\/\/.*$/, ''));
}

function isActivePublicProjectionSurface(file: string, text: string): boolean {
  return publicProjectionSurfaceFiles.has(file) && publicProjectionActivation.test(text);
}

function hasPublicProjectionGuard(file: string, text: string): boolean {
  if (publicEventSanitizerImport.test(text)) return true;
  return file === 'src/runtime/computer-use/package-bridge-presentation.ts'
    && /computerUseResultToTuiHostActions/.test(text);
}

function isUnsafePublicEventPayloadLine(file: string, fileText: string, line: string): boolean {
  if (!isActivePublicProjectionSurface(file, fileText)) return false;
  const code = line.replace(/\/\/.*$/, '');
  if (/UNSAFE_|FORBIDDEN_|REDACT|sanitize|Sanitizer/i.test(code)) return false;
  if (alwaysUnsafePublicEventPayloadLiteral.test(code)) return true;
  if (!guardedUnsafePublicEventPayloadLiteral.test(code)) return false;
  if (hasPublicProjectionGuard(file, fileText)) return false;
  if (/\b(?:commandText|terminalCommand|workspacePath|filePath|targetPath|stdout|stderr|requestBody|responseBody)\b\s*:\s*(?:string|number|boolean|unknown|Record\b|Array\b|readonly\b)/i.test(code)) {
    return false;
  }
  return true;
}

async function structuredManifestFindings(): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const rel of await collectComputerUseStructuredManifestFiles()) {
    const text = await readTextIfExists(join(root, rel));
    if (!text) continue;
    const manifest = parseJsonRecord(text);
    if (!manifest) continue;
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
    findings.push(...structuredComputerUsePrimitiveSurfaceFindings(rel, manifest));
    findings.push(...structuredSharedSystemInputFindings(rel, manifest));
  }
  return findings;
}

async function collectComputerUseStructuredManifestFiles(): Promise<string[]> {
  const dir = join(root, 'packages', 'actions', 'computer-use');
  const files = await collectFilesByExtensionIfExists(dir, '.json');
  return files
    .map((file) => relative(root, file).replaceAll('\\', '/'))
    .filter((file) => /(?:manifest|capability).*\.json$/.test(file));
}

async function collectFilesByExtensionIfExists(dir: string, extension: string): Promise<string[]> {
  try {
    return await collectFilesByExtension(dir, extension);
  } catch {
    return [];
  }
}

async function collectFilesByExtension(dir: string, extension: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name) || entry.name === 'fixtures') continue;
      files.push(...await collectFilesByExtension(join(dir, entry.name), extension));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === extension) files.push(join(dir, entry.name));
  }
  return files;
}

function structuredComputerUsePrimitiveSurfaceFindings(file: string, manifest: Record<string, unknown>): Finding[] {
  const findings: Finding[] = [];
  walkStructuredValue(manifest, [], (value, path) => {
    if (!isLikelyStructuredPublicSurfacePath(path)) return;
    if (typeof value === 'string') {
      const primitive = computerUsePrimitiveNameFromStructuredString(value, path);
      if (primitive && !isAllowedComputerUsePrimitiveName(primitive)) {
        findings.push({
          file,
          line: 1,
          rule: 'forbidden-computer-use-public-primitive-surface',
          message: 'Computer Use manifest/capability public primitive surface must only expose bind/observe/act/run_procedure/control.',
          text: path.join('.'),
        });
      }
      if (forbiddenComputerUsePublicIntentNames.has(value)) {
        findings.push({
          file,
          line: 1,
          rule: 'forbidden-computer-use-public-primitive-surface',
          message: 'Computer Use manifest/capability public primitive surface must not expose task, completion, planning, locating, or verification intents.',
          text: path.join('.'),
        });
      }
    }
    if (path.length && forbiddenComputerUsePublicIntentNames.has(path[path.length - 1] ?? '')) {
      findings.push({
        file,
        line: 1,
        rule: 'forbidden-computer-use-public-primitive-surface',
        message: 'Computer Use manifest/capability public primitive surface must not expose task, completion, planning, locating, or verification intent keys.',
        text: path.join('.'),
      });
    }
  });
  return findings;
}

function structuredSharedSystemInputFindings(file: string, manifest: Record<string, unknown>): Finding[] {
  const findings: Finding[] = [];
  walkStructuredValue(manifest, [], (value, path) => {
    if (!isRecord(value)) return;
    const usesSharedSystemInput = value.sharedSystemInput === true || value.sharedSystemInputUsed === true;
    if (!usesSharedSystemInput) return;
    if (value.maturity === 'live-diagnostic' && value.productReady === false) return;
    findings.push({
      file,
      line: 1,
      rule: 'forbidden-shared-system-input-product-ready',
      message: 'shared-system-input manifest/capability claims must be maturity=live-diagnostic and productReady=false.',
      text: path.join('.') || '(root)',
    });
  });
  return findings;
}

function computerUsePrimitiveNameFromStructuredString(value: string, path: string[]): string | undefined {
  const intent = value.match(/\bcomputer_use\.([A-Za-z0-9_-]+)\b/);
  if (intent) return intent[1];
  if (path.some((part) => part === 'schemaRef')) return undefined;
  if (!path.some((part) => /^(?:schemaVersion|enum|const|\d+)$/.test(part))) return undefined;
  const schema = value.match(/\bsciforge\.computer-use\.([a-z0-9_-]+)-input\.v\d+\b/);
  return schema?.[1];
}

function isLikelyStructuredPublicSurfacePath(path: string[]): boolean {
  const joined = path.join('.');
  return /\b(?:actionSchema|hostPortsContract|mcpTools|tools|tool|inputShape|properties|schemaVersion|requiredPorts|forbiddenPorts|primitive|primitives|intent|intents|capability|capabilities|publicSurface)\b/i.test(joined);
}

function walkStructuredValue(value: unknown, path: string[], visit: (value: unknown, path: string[]) => void): void {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStructuredValue(item, [...path, String(index)], visit));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    walkStructuredValue(child, [...path, key], visit);
  }
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
