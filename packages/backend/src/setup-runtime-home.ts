import { ensureRuntimeHome } from './runtime-home';

const options = parseArgs(process.argv.slice(2));
const paths = await ensureRuntimeHome(options);

console.log(`Runtime CODEX_HOME: ${paths.codexHome}`);
console.log(`Runtime config: ${paths.configPath}`);
console.log(`Runtime memories: ${paths.memoriesDir}`);
console.log(`Default runtime workspace: ${paths.defaultWorkspace}`);

function parseArgs(args: string[]) {
  const get = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    proxyBaseUrl: get('--proxy-base-url') ?? process.env.SCIFORGE_PROXY_BASE_URL,
    overwrite: args.includes('--overwrite'),
  };
}
