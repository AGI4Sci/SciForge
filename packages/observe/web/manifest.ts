import webFetchManifest from './capabilities/web_fetch.manifest.json';
import webSearchManifest from './capabilities/web_search.manifest.json';

export const webObserveCapabilityManifests = [
  webSearchManifest,
  webFetchManifest,
];

export function webObserveCapabilityManifest(id: string) {
  return webObserveCapabilityManifests.find((manifest) => manifest.id === id);
}
