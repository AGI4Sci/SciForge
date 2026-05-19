import { homedir, platform, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type DesktopAppDataLayout = {
  schemaVersion: 'sciforge.desktop.app-data.v1';
  appName: string;
  appDataRoot: string;
  configDir: string;
  runtimeCodexHome: string;
  logDir: string;
  cacheDir: string;
  globalStateDir: string;
  userWorkspaceStateDir: string;
};

export type DesktopAppDataLayoutOptions = {
  appName?: string;
  appDataRoot?: string;
  workspacePath: string;
  workspaceStateDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_APP_NAME = 'SciForge';

export function buildDesktopAppDataLayout(options: DesktopAppDataLayoutOptions): DesktopAppDataLayout {
  const appName = safeAppName(options.appName ?? DEFAULT_APP_NAME);
  const appDataRoot = resolve(options.appDataRoot ?? defaultAppDataRoot(appName, options.platform, options.env));
  const workspacePath = resolve(options.workspacePath);
  return {
    schemaVersion: 'sciforge.desktop.app-data.v1',
    appName,
    appDataRoot,
    configDir: join(appDataRoot, 'config'),
    runtimeCodexHome: join(appDataRoot, 'runtime-codex-home'),
    logDir: join(appDataRoot, 'logs'),
    cacheDir: join(appDataRoot, 'cache'),
    globalStateDir: join(appDataRoot, 'state'),
    userWorkspaceStateDir: resolve(options.workspaceStateDir ?? join(workspacePath, '.sciforge')),
  };
}

export function defaultAppDataRoot(
  appName = DEFAULT_APP_NAME,
  targetPlatform: NodeJS.Platform = platform(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const safeName = safeAppName(appName);
  if (targetPlatform === 'darwin') {
    return join(env.HOME ?? homedir(), 'Library', 'Application Support', safeName);
  }
  if (targetPlatform === 'win32') {
    return join(env.APPDATA ?? join(env.USERPROFILE ?? homedir(), 'AppData', 'Roaming'), safeName);
  }
  return join(env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), '.local', 'share'), safeName);
}

function safeAppName(value: string): string {
  const name = value.trim().replace(/[\\/:\0]/g, '-');
  return name || DEFAULT_APP_NAME;
}

export function temporaryDesktopAppDataRoot(label = 'sciforge-desktop'): string {
  return join(tmpdir(), label);
}
