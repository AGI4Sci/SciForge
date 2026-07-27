import type { CodingPlanAdapter } from './contract';

export class CodingPlanAdapterRegistry {
  readonly #adapters = new Map<string, CodingPlanAdapter>();

  constructor(adapters: Iterable<CodingPlanAdapter> = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: CodingPlanAdapter): this {
    validateAdapter(adapter);
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Coding plan adapter is already registered: ${adapter.id}`);
    }
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  get(adapterId: string): CodingPlanAdapter {
    const adapter = this.#adapters.get(adapterId);
    if (!adapter) throw new Error(`Unsupported coding plan adapter: ${adapterId}`);
    return adapter;
  }

  list(): readonly CodingPlanAdapter[] {
    return [...this.#adapters.values()];
  }
}

function validateAdapter(adapter: CodingPlanAdapter): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(adapter.id)) {
    throw new Error(`Invalid coding plan adapter id: ${adapter.id}`);
  }

  const upstream = new URL(adapter.upstreamBaseUrl);
  if (upstream.protocol !== 'https:') {
    throw new Error(`Coding plan adapter upstream must use HTTPS: ${adapter.id}`);
  }
  if (upstream.username || upstream.password || upstream.search || upstream.hash) {
    throw new Error(`Coding plan adapter upstream must be a fixed credential-free base URL: ${adapter.id}`);
  }
  if (!['responses', 'chat-completions', 'anthropic-messages'].includes(adapter.wireProtocol)) {
    throw new Error(`Coding plan adapter has an unsupported wire protocol: ${adapter.id}`);
  }

  if (adapter.allowedRoutes.length === 0) {
    throw new Error(`Coding plan adapter must allow at least one route: ${adapter.id}`);
  }
  const routes = new Set<string>();
  for (const route of adapter.allowedRoutes) {
    const method = route.method.toUpperCase();
    if (!/^[A-Z]+$/.test(method) || !isSafeRoutePath(route.path)) {
      throw new Error(`Invalid route in coding plan adapter ${adapter.id}`);
    }
    const key = `${method} ${route.path}`;
    if (routes.has(key)) throw new Error(`Duplicate route in coding plan adapter ${adapter.id}: ${key}`);
    routes.add(key);
  }
}

function isSafeRoutePath(path: string): path is `/${string}` {
  return path.startsWith('/')
    && !path.startsWith('//')
    && !path.includes('?')
    && !path.includes('#')
    && !path.split('/').some((part) => part === '.' || part === '..');
}
