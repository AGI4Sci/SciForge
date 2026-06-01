import type {
  ChannelHostPorts,
  ChannelIntakeLease,
  ChannelPlugin,
  ChannelPluginManifest,
  ChannelResourceQuery,
  ChannelResourceRead,
  ChannelResourceResult,
  DeliveryDraftResult,
  DeliveryEnvelope,
  DeliveryResult,
} from '../../contracts/runtime/channel-plugin';
import { parseFeishuApprovalReply } from './confirmation/parseApprovalReply';
import { draftFeishuDelivery } from './delivery/draft';
import { sendFeishuDelivery } from './delivery/send';
import { ingestFeishuCliEventStream } from './intake/cliEventStream';
import { normalizeFeishuIncomingEvent } from './intake/normalizeMessage';
import { LarkCliProvider } from './larkCliProvider';
import { feishuChannelPluginManifest } from './manifest';
import { queryFeishuResource, readFeishuResource } from './resources';

export interface FeishuChannelPluginOptions {
  provider?: LarkCliProvider;
  hostPorts?: ChannelHostPorts;
  accountId: string;
  policyRef: string;
  tenant?: string;
  bot?: string;
}

export class FeishuChannelPlugin implements ChannelPlugin {
  private readonly provider: LarkCliProvider;
  private readonly hostPorts?: ChannelHostPorts;
  private readonly options: FeishuChannelPluginOptions;

  constructor(options: FeishuChannelPluginOptions) {
    this.provider = options.provider ?? new LarkCliProvider();
    this.hostPorts = options.hostPorts;
    this.options = options;
  }

  describe(): ChannelPluginManifest {
    return feishuChannelPluginManifest;
  }

  async startIntake(ports: ChannelHostPorts = this.requiredHostPorts()): Promise<ChannelIntakeLease> {
    const startedAt = isoFromClock(ports.clock ?? (() => new Date()));
    let stopped = false;
    void ingestFeishuCliEventStream(this.provider, ports, {
      accountId: this.options.accountId,
      policyRef: this.options.policyRef,
      tenant: this.options.tenant,
      bot: this.options.bot,
    });
    return {
      leaseRef: `feishu:intake-lease:${this.options.accountId}:${startedAt}`,
      channel: 'feishu',
      startedAt,
      async stop() {
        stopped = true;
        void stopped;
      },
    };
  }

  async queryResource(request: ChannelResourceQuery): Promise<ChannelResourceResult> {
    return queryFeishuResource(this.provider, request);
  }

  async readResource(request: ChannelResourceRead): Promise<ChannelResourceResult> {
    return readFeishuResource(this.provider, request);
  }

  async draftDelivery(request: DeliveryEnvelope): Promise<DeliveryDraftResult> {
    return draftFeishuDelivery(this.provider, request);
  }

  async sendDelivery(request: DeliveryEnvelope): Promise<DeliveryResult> {
    return sendFeishuDelivery(this.provider, request, this.requiredHostPorts());
  }

  async handleConfirmation(event: ReturnType<typeof normalizeFeishuIncomingEvent>) {
    return parseFeishuApprovalReply(event);
  }

  private requiredHostPorts(): ChannelHostPorts {
    if (!this.hostPorts) throw new Error('FeishuChannelPlugin requires Agent Host ports for intake and delivery side effects.');
    return this.hostPorts;
  }
}

export function createFeishuChannelPlugin(options: FeishuChannelPluginOptions): FeishuChannelPlugin {
  return new FeishuChannelPlugin(options);
}

function isoFromClock(now: () => Date | string): string {
  const value = now();
  return value instanceof Date ? value.toISOString() : value;
}
