import {
  renderImageEvidenceViewer,
  type ImageEvidencePayload,
} from '../../../../../packages/presentation/components';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { resultText, type ResultLocale } from './resultLocale';
import { rightPaneImageEvidencePayload } from './imagePaneModel';

export interface RightPaneImageEvidenceSlot {
  componentId: 'image-evidence-viewer';
  title: string;
  props: Record<string, unknown>;
}

export function rightPaneImageEvidenceSlot({
  payload,
  locale,
}: {
  payload?: ImageEvidencePayload;
  locale?: ResultLocale;
}): RightPaneImageEvidenceSlot {
  return {
    componentId: 'image-evidence-viewer',
    title: resultText(locale, { 'zh-CN': '图片 / 证据', 'en-US': 'Image / Evidence' }),
    props: { ...(payload ?? {
      sourceKind: 'artifact',
      imageRef: '',
      ref: '',
      status: 'empty',
    }) },
  };
}

export function rightPaneImageEvidenceArtifact(payload?: ImageEvidencePayload): RuntimeArtifact {
  return {
    id: 'right-pane-image-evidence',
    type: 'image-evidence',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.image-evidence.payload.v1',
    data: payload ?? {},
  };
}

export function RightPaneImageEvidenceTool({
  config,
  session,
  activeRun,
  payload: providedPayload,
  locale,
}: {
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  payload?: ImageEvidencePayload;
  locale?: ResultLocale;
}) {
  const payload = providedPayload ?? rightPaneImageEvidencePayload(session, activeRun);

  return (
    <div
      className="right-pane-package-surface right-pane-image-evidence-surface"
      data-testid="right-pane-image-evidence-tool"
      data-host-presentation-boundary="image-evidence-ref-only"
      data-host-presentation-ready={payload?.imageRef ? 'true' : 'false'}
    >
      {renderImageEvidenceViewer({
        slot: rightPaneImageEvidenceSlot({ payload, locale }),
        artifact: rightPaneImageEvidenceArtifact(payload),
        config,
        session,
      })}
    </div>
  );
}
