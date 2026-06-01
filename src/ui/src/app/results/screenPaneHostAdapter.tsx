import {
  renderVirtualScreenViewer,
  type VirtualScreenPayload,
} from '../../../../../packages/presentation/components';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { resultText, type ResultLocale } from './resultLocale';
import { rightPaneVirtualScreenPayload } from './screenPaneModel';

export interface RightPaneVirtualScreenCommandEvent {
  commandText: string;
  label: string;
  targetRef?: string;
}

export type RightPaneVirtualScreenSlotProps = Record<string, unknown> & VirtualScreenPayload & {
  onTerminalEquivalentText: (event: RightPaneVirtualScreenCommandEvent) => void;
};

export interface RightPaneVirtualScreenSlot {
  componentId: 'virtual-screen-viewer';
  title: string;
  props: RightPaneVirtualScreenSlotProps;
}

export function rightPaneVirtualScreenSlot({
  payload,
  locale,
  onCommandRequest,
}: {
  payload: VirtualScreenPayload;
  locale?: ResultLocale;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
}): RightPaneVirtualScreenSlot {
  const props = {
    ...(payload as Record<string, unknown>),
    onTerminalEquivalentText: (event: RightPaneVirtualScreenCommandEvent) => {
      onCommandRequest(event.commandText, event.label, event.targetRef);
    },
  } as RightPaneVirtualScreenSlotProps;
  return {
    componentId: 'virtual-screen-viewer',
    title: resultText(locale, { 'zh-CN': '虚拟屏幕', 'en-US': 'Virtual Screen' }),
    props,
  };
}

export function rightPaneVirtualScreenArtifact(payload: VirtualScreenPayload): RuntimeArtifact {
  return {
    id: 'right-pane-virtual-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: payload,
  };
}

export function RightPaneVirtualScreenTool({
  config,
  session,
  activeRun,
  locale,
  onCommandRequest,
}: {
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  locale?: ResultLocale;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
}) {
  const payload = rightPaneVirtualScreenPayload(session, activeRun, config, locale);
  return (
    <div className="right-pane-package-surface right-pane-virtual-screen-surface" data-testid="right-pane-virtual-screen-tool">
      {renderVirtualScreenViewer({
        slot: rightPaneVirtualScreenSlot({ payload, locale, onCommandRequest }),
        artifact: rightPaneVirtualScreenArtifact(payload),
        config,
        session,
      })}
    </div>
  );
}
