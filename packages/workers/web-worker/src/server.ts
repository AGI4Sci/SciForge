import { startToolWorkerServer, type StartedToolHttpServer } from '../../../contracts/tool-worker/src/index';
import { createWebWorker } from './worker';

export interface StartWebWorkerServerOptions {
  host?: string;
  port?: number;
}

export function startWebWorkerServer(options: StartWebWorkerServerOptions = {}): Promise<StartedToolHttpServer> {
  return startToolWorkerServer(createWebWorker(), options);
}
