import type { ReactNode } from 'react';
import type { UIComponentRendererProps } from './types';
import { renderBrowserWorkbench } from './browser-workbench/render';
import { renderComputerUseControlPlane } from './computer-use-control-plane/render';
import { renderScientificPlotViewer } from './scientific-plot-viewer/render';
import { renderTerminalSessionViewer } from './terminal-session-viewer/render';
import { renderVirtualScreenViewer } from './virtual-screen-viewer/render';
import { renderWorkspaceFileViewer } from './workspace-file-viewer/render';

type WorkbenchRenderer = (props: UIComponentRendererProps) => ReactNode;

const workbenchRenderers: Record<string, WorkbenchRenderer> = {
  'browser-workbench': renderBrowserWorkbench,
  'computer-use-control-plane': renderComputerUseControlPlane,
  'virtual-screen-viewer': renderVirtualScreenViewer,
  'terminal-session-viewer': renderTerminalSessionViewer,
  'workspace-file-viewer': renderWorkspaceFileViewer,
  'scientific-plot-viewer': renderScientificPlotViewer,
};

export function renderPackageWorkbenchPreview<TProps extends UIComponentRendererProps>(
  props: TProps,
  fallback: (props: TProps) => ReactNode,
): ReactNode {
  const renderer = workbenchRenderers[props.slot.componentId];
  return renderer ? renderer(props) : fallback(props);
}
