import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';

export type DesktopPlatform = 'darwin' | 'win32' | 'linux';

export type PlatformCommandPlan = {
  command: string;
  args: string[];
};

export type PlatformServiceOptions = {
  platform?: NodeJS.Platform;
  execFileImpl?: typeof execFile;
  accessImpl?: typeof access;
  killImpl?: (pid: number, signal?: NodeJS.Signals | number) => void;
};

export class DesktopPlatformService {
  private readonly platform: DesktopPlatform;
  private readonly execFileImpl: typeof execFile;
  private readonly accessImpl: typeof access;
  private readonly killImpl: (pid: number, signal?: NodeJS.Signals | number) => void;

  constructor(options: PlatformServiceOptions = {}) {
    this.platform = normalizePlatform(options.platform ?? process.platform);
    this.execFileImpl = options.execFileImpl ?? execFile;
    this.accessImpl = options.accessImpl ?? access;
    this.killImpl = options.killImpl ?? process.kill;
  }

  quotePath(path: string): string {
    if (this.platform === 'win32') return `"${path.replace(/"/g, '""')}"`;
    return `'${path.replace(/'/g, `'\\''`)}'`;
  }

  openExternalPlan(url: string): PlatformCommandPlan {
    assertExternalUrl(url);
    if (this.platform === 'darwin') return { command: 'open', args: [url] };
    if (this.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
    return { command: 'xdg-open', args: [url] };
  }

  revealInFolderPlan(path: string): PlatformCommandPlan {
    if (this.platform === 'darwin') return { command: 'open', args: ['-R', path] };
    if (this.platform === 'win32') return { command: 'explorer.exe', args: ['/select,', path] };
    return { command: 'xdg-open', args: [path] };
  }

  terminalCommandPlan(cwd: string, commandText = ''): PlatformCommandPlan {
    if (this.platform === 'darwin') {
      const script = commandText
        ? `tell application "Terminal" to do script "cd ${escapeAppleScript(this.quotePath(cwd))} && ${escapeAppleScript(commandText)}"`
        : `tell application "Terminal" to do script "cd ${escapeAppleScript(this.quotePath(cwd))}"`;
      return { command: 'osascript', args: ['-e', script] };
    }
    if (this.platform === 'win32') {
      const command = commandText ? `cd /d ${this.quotePath(cwd)} && ${commandText}` : `cd /d ${this.quotePath(cwd)}`;
      return { command: 'cmd', args: ['/c', 'start', 'cmd', '/k', command] };
    }
    const command = commandText ? `cd ${this.quotePath(cwd)} && ${commandText}` : `cd ${this.quotePath(cwd)}`;
    return { command: 'x-terminal-emulator', args: ['-e', 'sh', '-lc', command] };
  }

  async openExternal(url: string): Promise<void> {
    await this.run(this.openExternalPlan(url));
  }

  async revealInFolder(path: string): Promise<void> {
    await this.run(this.revealInFolderPlan(path));
  }

  async openTerminal(cwd: string, commandText = ''): Promise<void> {
    await this.run(this.terminalCommandPlan(cwd, commandText));
  }

  killProcess(pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): void {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid pid for platform kill: ${pid}`);
    this.killImpl(pid, signal);
  }

  async permissionProbe(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.accessImpl(path);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private run(plan: PlatformCommandPlan): Promise<void> {
    return new Promise((resolve, reject) => {
      this.execFileImpl(plan.command, plan.args, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function normalizePlatform(value: NodeJS.Platform): DesktopPlatform {
  if (value === 'darwin' || value === 'win32') return value;
  return 'linux';
}

function assertExternalUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to open non-web URL through desktop platform service: ${parsed.protocol}`);
  }
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
