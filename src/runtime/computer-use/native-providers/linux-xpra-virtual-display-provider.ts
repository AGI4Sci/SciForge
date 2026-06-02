import {
  createPlatformVirtualDisplayProviderShell,
  type PlatformVirtualDisplayOperationEvidence,
  type PlatformVirtualDisplayOperationHook,
  type PlatformVirtualDisplayProviderHooks,
} from './platform-virtual-display-provider-shell.js';
import type {
  VirtualDisplayProviderL1Contract,
  VirtualDisplayProviderOperationOptions,
} from '../virtual-display-provider.js';

export const LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID = 'virtual-display.linux.xpra' as const;

export type LinuxXpraVirtualDisplayOperationEvidence = PlatformVirtualDisplayOperationEvidence;
export type LinuxXpraVirtualDisplayOperationHook = PlatformVirtualDisplayOperationHook;
export type LinuxXpraVirtualDisplayProviderHooks = PlatformVirtualDisplayProviderHooks;

export interface LinuxXpraVirtualDisplayProviderOptions {
  providerId?: string;
  hooks?: LinuxXpraVirtualDisplayProviderHooks;
  probeOptions?: VirtualDisplayProviderOperationOptions['probeOptions'];
}

export function createLinuxXpraVirtualDisplayProvider(
  options: LinuxXpraVirtualDisplayProviderOptions = {},
): VirtualDisplayProviderL1Contract {
  return createPlatformVirtualDisplayProviderShell({
    providerId: options.providerId ?? LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    platform: 'linux',
    providerLabel: 'Linux Xpra VirtualDisplayProvider',
    hooks: options.hooks,
    probeOptions: options.probeOptions,
  });
}
