import browserFetchManifest from './capabilities/browser_fetch.manifest.json';
import browserSearchManifest from './capabilities/browser_search.manifest.json';
import webFetchManifest from './capabilities/web_fetch.manifest.json';
import webSearchManifest from './capabilities/web_search.manifest.json';

export const webObserveCapabilityManifests = [
  webSearchManifest,
  webFetchManifest,
  browserSearchManifest,
  browserFetchManifest,
];

export function webObserveCapabilityManifest(id: string) {
  return webObserveCapabilityManifests.find((manifest) => manifest.id === id);
}
