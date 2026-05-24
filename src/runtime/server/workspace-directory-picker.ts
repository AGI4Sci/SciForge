import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

export type WorkspaceDirectoryPickerOptions = {
  platform?: NodeJS.Platform;
  execFileImpl?: typeof execFile;
  accessImpl?: typeof access;
  prompt?: string;
  defaultPath?: string;
};

export async function pickWorkspaceDirectoryPath(options: WorkspaceDirectoryPickerOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const prompt = options.prompt ?? '选择 SciForge 项目文件夹';
  const accessImpl = options.accessImpl ?? access;
  const defaultPath = await resolvePickerDefaultPath(options.defaultPath, accessImpl);
  const execFileImpl = options.execFileImpl ?? execFile;
  if (platform === 'darwin') {
    const script = defaultPath
      ? `POSIX path of (choose folder with prompt "${escapeAppleScript(prompt)}" default location (POSIX file "${escapeAppleScript(defaultPath)}"))`
      : `POSIX path of (choose folder with prompt "${escapeAppleScript(prompt)}")`;
    const stdout = await runExecFile(execFileImpl, 'osascript', ['-e', script]);
    const picked = stdout.trim();
    return picked ? resolve(picked.replace(/\/+$/, '')) : null;
  }
  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$dialog.Description = '${escapePowerShellSingleQuoted(prompt)}'`,
      defaultPath ? `$dialog.SelectedPath = '${escapePowerShellSingleQuoted(defaultPath)}'` : '',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  Write-Output $dialog.SelectedPath',
      '}',
    ].filter(Boolean).join('; ');
    const stdout = await runExecFile(execFileImpl, 'powershell.exe', ['-NoProfile', '-Command', script]);
    const picked = stdout.trim();
    return picked ? resolve(picked) : null;
  }
  try {
    const args = ['--file-selection', '--directory', '--title', prompt];
    if (defaultPath) args.push('--filename', defaultPath);
    const stdout = await runExecFile(execFileImpl, 'zenity', args);
    const picked = stdout.trim();
    return picked ? resolve(picked) : null;
  } catch {
    return null;
  }
}

function runExecFile(execFileImpl: typeof execFile, command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFileImpl(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      const message = `${stderr ?? ''}`.trim();
      if (error) {
        const detail = `${error.message}\n${message}`;
        if (/User canceled|User cancelled|用户取消|cancelled|canceled|-128/i.test(detail)) {
          resolvePromise('');
          return;
        }
        reject(new Error(message || error.message));
        return;
      }
      resolvePromise(String(stdout ?? ''));
    });
  });
}

async function resolvePickerDefaultPath(defaultPath: string | undefined, accessImpl: typeof access): Promise<string | undefined> {
  if (!defaultPath?.trim()) return undefined;
  const resolved = resolve(defaultPath.trim());
  try {
    await accessImpl(resolved);
    return resolved;
  } catch {
    return undefined;
  }
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}
