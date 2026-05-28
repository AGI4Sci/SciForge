import browserFetchManifest from './capabilities/browser_fetch.manifest.json';
import browserRuntimeManifest from './capabilities/browser_runtime.manifest.json';
import browserSearchManifest from './capabilities/browser_search.manifest.json';
import playwrightBrowserAutomationManifest from './capabilities/playwright_browser_automation.manifest.json';
import playwrightEdgeBrowserManifest from './capabilities/playwright_edge_browser.manifest.json';
import webFetchManifest from './capabilities/web_fetch.manifest.json';
import webSearchManifest from './capabilities/web_search.manifest.json';

export {
  BROWSER_RUNTIME_CAPABILITY_ID,
  BROWSER_RUNTIME_PROVIDER_ID,
  browserRuntimeCodexFeatureMatrix,
  browserRuntimeCommandRisk,
  browserRuntimePlaywrightActionsForCommand,
  browserRuntimeProjection,
  browserRuntimeSnapshotFromRefs,
  browserRuntimeTraceForCommand,
  type BrowserRuntimeCodexFeature,
  type BrowserRuntimeCommand,
  type BrowserRuntimeCommandRisk,
  type BrowserRuntimeMode,
  type BrowserRuntimePlaywrightAction,
  type BrowserRuntimeProjection,
  type BrowserRuntimeSession,
  type BrowserRuntimeSnapshot,
  type BrowserRuntimeTab,
  type BrowserRuntimeTrace,
  type BrowserRuntimeTraceRef,
  type BrowserRuntimeTraceRefKind,
} from './browser-runtime';
export {
  buildParallelPlaywrightBrowserMcpServersConfig,
  buildPlaywrightBrowserMcpCodexTomlSnippet,
  buildPlaywrightBrowserMcpProviderAvailability,
  buildPlaywrightBrowserMcpServerConfig,
  buildPlaywrightBrowserMcpServersConfig,
  buildPlaywrightBrowserMcpToolProviderRoutes,
  playwrightBrowserMcpHttpUrl,
  playwrightBrowserMcpOutputDir,
  playwrightBrowserMcpServerName,
  playwrightBrowserMcpUserDataDir,
  PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID,
  PLAYWRIGHT_BROWSER_MCP_DEFAULT_BROWSER,
  PLAYWRIGHT_BROWSER_MCP_DEFAULT_VIEWPORT,
  PLAYWRIGHT_BROWSER_MCP_PACKAGE,
  PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID,
  PLAYWRIGHT_BROWSER_MCP_SERVER_NAME,
  type PlaywrightBrowserMcpBrowser,
  type PlaywrightBrowserMcpPathOptions,
  type PlaywrightBrowserMcpProviderAvailabilityOptions,
  type PlaywrightBrowserMcpServerConfig,
  type PlaywrightBrowserMcpServerOptions,
  type PlaywrightBrowserMcpServersConfig,
} from './mcp/playwright-browser';
export {
  createPlaywrightBrowserAutomationProvider,
  invokePlaywrightBrowserAutomation,
  type PlaywrightBrowserAutomationInvocationInput,
  type PlaywrightBrowserAutomationInvocationOutput,
  type PlaywrightBrowserAutomationProvider,
  type PlaywrightBrowserAutomationProviderOptions,
} from './mcp/playwright-browser-provider';
export {
  buildParallelPlaywrightEdgeMcpServersConfig,
  buildPlaywrightEdgeMcpCodexTomlSnippet,
  buildPlaywrightEdgeMcpProviderAvailability,
  buildPlaywrightEdgeMcpServerConfig,
  buildPlaywrightEdgeMcpServersConfig,
  buildPlaywrightEdgeMcpToolProviderRoutes,
  playwrightEdgeMcpHttpUrl,
  playwrightEdgeMcpOutputDir,
  playwrightEdgeMcpServerName,
  playwrightEdgeMcpUserDataDir,
  PLAYWRIGHT_EDGE_MCP_BROWSER,
  PLAYWRIGHT_EDGE_MCP_CAPABILITY_ID,
  PLAYWRIGHT_EDGE_MCP_DEFAULT_VIEWPORT,
  PLAYWRIGHT_EDGE_MCP_PACKAGE,
  PLAYWRIGHT_EDGE_MCP_PROVIDER_ID,
  PLAYWRIGHT_EDGE_MCP_SERVER_NAME,
  type PlaywrightEdgeMcpPathOptions,
  type PlaywrightEdgeMcpProviderAvailabilityOptions,
  type PlaywrightEdgeMcpServerConfig,
  type PlaywrightEdgeMcpServerOptions,
  type PlaywrightEdgeMcpServersConfig,
} from './mcp/playwright-edge';
export {
  createPlaywrightEdgeBrowserAutomationProvider,
  invokePlaywrightEdgeBrowser,
  type PlaywrightEdgeBrowserAutomationProvider,
  type PlaywrightEdgeBrowserAutomationProviderOptions,
  type PlaywrightEdgeBrowserInvocationInput,
  type PlaywrightEdgeBrowserInvocationOutput,
} from './mcp/playwright-edge-provider';

export const webObserveCapabilityManifests = [
  webSearchManifest,
  webFetchManifest,
  browserSearchManifest,
  browserFetchManifest,
  browserRuntimeManifest,
  playwrightBrowserAutomationManifest,
  playwrightEdgeBrowserManifest,
];

export function webObserveCapabilityManifest(id: string) {
  return webObserveCapabilityManifests.find((manifest) => manifest.id === id);
}
