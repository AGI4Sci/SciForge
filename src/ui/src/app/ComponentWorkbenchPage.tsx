import { Plug } from 'lucide-react';
import { EmptyState, SectionHeader } from './uiPrimitives';

export function ComponentWorkbenchPage() {
  return (
    <main className="component-workbench-page apps-page">
      <SectionHeader
        icon={Plug}
        title="应用"
        subtitle="第三方应用与协作工具将在此接入与管理，例如微信、飞书等。"
      />
      <section className="apps-empty-state" aria-label="应用列表">
        <EmptyState
          label="即将推出"
          title="暂无已安装应用"
          detail="SciForge 正在扩展应用接入能力。未来你可以在这里安装、授权和管理第三方应用，并在研究工作流中直接使用。"
        />
      </section>
    </main>
  );
}
