import type { ReactNode } from 'react';
import type { UIComponentRendererProps } from './types';
import { renderScientificPlotViewer } from './scientific-plot-viewer/render';

type WorkbenchRenderer = (props: UIComponentRendererProps) => ReactNode;

const workbenchRenderers: Record<string, WorkbenchRenderer> = {
  'scientific-plot-viewer': renderScientificPlotViewer,
};

export function renderPackageWorkbenchPreview<TProps extends UIComponentRendererProps>(
  props: TProps,
  fallback: (props: TProps) => ReactNode,
): ReactNode {
  const renderer = workbenchRenderers[props.slot.componentId];
  return renderer ? renderer(props) : fallback(props);
}
