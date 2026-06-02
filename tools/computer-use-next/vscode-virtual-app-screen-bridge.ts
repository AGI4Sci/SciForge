export const VSCODE_BRIDGE_EXTENSION_JS = `
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const SCHEMA = 'sciforge.vscode.bridge.result.v1';
let lastRequestId = undefined;

function bridgeDataDir() {
  const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return workspaceFolder ? path.join(workspaceFolder.uri.fsPath, '.sciforge-vscode-bridge') : undefined;
}

function writeResult(dir, value) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({
    schemaVersion: SCHEMA,
    extensionHostPid: process.pid,
    writtenAt: new Date().toISOString(),
    ...value,
  }, null, 2));
}

function readRequest(dir) {
  const requestPath = path.join(dir, 'request.json');
  if (!fs.existsSync(requestPath)) return undefined;
  return JSON.parse(fs.readFileSync(requestPath, 'utf8'));
}

async function executeRequest(dir, request) {
  const uri = vscode.Uri.file(request.filePath);
  fs.mkdirSync(path.dirname(request.filePath), { recursive: true });
  if (!fs.existsSync(request.filePath)) {
    fs.writeFileSync(request.filePath, '');
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: true,
    viewColumn: vscode.ViewColumn.One,
  });
  const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
  const fullRange = new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, fullRange, request.text);
  const appliedEdit = await vscode.workspace.applyEdit(edit);
  const saved = await document.save();
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  editor.revealRange(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), vscode.TextEditorRevealType.AtTop);
  writeResult(dir, {
    requestId: request.requestId,
    status: appliedEdit && saved ? 'completed' : 'failed',
    ok: appliedEdit && saved,
    openedDocument: true,
    revealedRange: true,
    appliedEdit,
    saved,
    filePath: request.filePath,
    visibleTextEditorDocument: editor.document.uri.fsPath,
    profileId: request.profileId,
    nonDestructive: request.nonDestructive === true,
    workspaceScope: request.workspaceScope,
    isolationFlags: request.isolationFlags,
  });
}

function activate(context) {
  const dir = bridgeDataDir();
  if (!dir) return;
  writeResult(dir, { status: 'ready', ok: true, activatedAt: new Date().toISOString() });
  const timer = setInterval(() => {
    Promise.resolve().then(async () => {
      const request = readRequest(dir);
      if (!request || !request.requestId || request.requestId === lastRequestId) return;
      lastRequestId = request.requestId;
      try {
        await executeRequest(dir, request);
      } catch (error) {
        writeResult(dir, {
          requestId: request.requestId,
          status: 'failed',
          ok: false,
          error: error && error.stack ? String(error.stack) : String(error),
        });
      }
    }).catch((error) => {
      writeResult(dir, {
        status: 'failed',
        ok: false,
        error: error && error.stack ? String(error.stack) : String(error),
      });
    });
  }, 250);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function deactivate() {}

module.exports = { activate, deactivate };
`;
