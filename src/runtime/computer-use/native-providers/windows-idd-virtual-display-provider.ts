import type {
  VirtualDisplayProviderL1Contract,
  VirtualDisplayProviderOperationOptions,
} from '../virtual-display-provider.js';
import {
  createPlatformVirtualDisplayProviderShell,
  type PlatformVirtualDisplayOperationEvidence,
  type PlatformVirtualDisplayOperationHook,
  type PlatformVirtualDisplayProviderHooks,
} from './platform-virtual-display-provider-shell.js';

export const WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID = 'virtual-display.windows.idd' as const;

export type WindowsIddVirtualDisplayOperationEvidence = PlatformVirtualDisplayOperationEvidence;
export type WindowsIddVirtualDisplayOperationHook = PlatformVirtualDisplayOperationHook;
export type WindowsIddVirtualDisplayProviderHooks = PlatformVirtualDisplayProviderHooks;

export interface WindowsIddVirtualDisplayProviderOptions {
  providerId?: string;
  hooks?: WindowsIddVirtualDisplayProviderHooks;
  probeOptions?: VirtualDisplayProviderOperationOptions['probeOptions'];
}

export function createWindowsIddVirtualDisplayProvider(
  options: WindowsIddVirtualDisplayProviderOptions = {},
): VirtualDisplayProviderL1Contract {
  return createPlatformVirtualDisplayProviderShell({
    providerId: options.providerId ?? WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    platform: 'win32',
    providerLabel: 'Windows IDD VirtualDisplayProvider',
    hooks: options.hooks,
    probeOptions: options.probeOptions,
  });
}
