import { createBuiltInPlanAdapterRegistry } from './adapters';
import { resolvePlanGatewayCliOptions } from './cli-options';
import { HttpsPlanGatewayTransport, startPlanGatewayServer } from './gateway';
import { createPlanGatewayTraceCapture } from './trace-sink';

const options = resolvePlanGatewayCliOptions(process.argv.slice(2));
const registry = createBuiltInPlanAdapterRegistry();
if ((options.userDataDirectory === undefined) === (options.traceStorageDirectory === undefined)) {
  throw new Error('Plan Gateway requires exactly one trace location: --user-data-dir or --trace-storage-dir.');
}
const traceCapture = await createPlanGatewayTraceCapture({
  adapterRegistry: registry,
  ...(options.userDataDirectory
    ? { userDataDirectory: options.userDataDirectory }
    : { storageDirectory: options.traceStorageDirectory as string }),
});
const started = await startPlanGatewayServer({
  adapterId: options.adapterId,
  adapterRegistry: registry,
  host: options.host,
  port: options.port,
  mountPath: options.mountPath,
  instanceId: options.instanceId,
  transport: new HttpsPlanGatewayTransport(options.proxyRules),
  eventSink: traceCapture.eventSink,
  log: options.quiet ? undefined : (message) => console.error(`[sciforge-plan-gateway] ${message}`),
});

if (!options.quiet) {
  console.log(`SciForge Plan Gateway listening at ${started.url}`);
  console.log(`Coding plan adapter: ${started.adapterId}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await started.close();
    process.exit(0);
  });
}
