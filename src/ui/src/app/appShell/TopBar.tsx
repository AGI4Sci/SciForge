import { useState, type FormEvent } from 'react';
import { MessageSquare, Moon, Search, Settings, Sun } from 'lucide-react';
import type { SciForgeConfig } from '../../domain';
import { Badge, IconButton, cx } from '../uiPrimitives';
import type { RuntimeHealthItem } from '../runtimeHealthPanel';

export function TopBar({
  onSearch,
  onSettingsOpen,
  theme,
  onThemeToggle,
  healthItems,
  annotationModeActive = false,
  onAnnotationModeToggle = () => undefined,
}: {
  onSearch: (query: string) => void;
  onSettingsOpen: () => void;
  theme: SciForgeConfig['theme'];
  onThemeToggle: () => void;
  healthItems: RuntimeHealthItem[];
  annotationModeActive?: boolean;
  onAnnotationModeToggle?: () => void;
}) {
  const [query, setQuery] = useState('');
  const healthProblems = healthItems.filter((item) => item.status === 'offline' || item.status === 'not-configured' || item.status === 'checking').length;
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch(query);
  }
  return (
    <header className="topbar">
      <form className="searchbox" onSubmit={handleSubmit}>
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件、报告、问题..." />
      </form>
      <div className="topbar-actions">
        <button
          type="button"
          className={cx('topbar-annotation-button', annotationModeActive && 'active')}
          onClick={onAnnotationModeToggle}
          aria-pressed={annotationModeActive}
          aria-label={annotationModeActive ? '暂停注释点选' : '打开注释侧栏并开始点选'}
          data-feedback-control="true"
        >
          <MessageSquare size={15} aria-hidden />
          <span>注释</span>
        </button>
        <Badge variant={healthProblems ? 'warning' : 'success'} glow>
          SciForge · {healthProblems ? `${healthProblems} 项需处理` : '就绪'}
        </Badge>
        <IconButton icon={(theme ?? 'dark') === 'dark' ? Sun : Moon} label={(theme ?? 'dark') === 'dark' ? '切换白天模式' : '切换黑夜模式'} onClick={onThemeToggle} />
        <IconButton icon={Settings} label="设置" onClick={onSettingsOpen} />
      </div>
    </header>
  );
}
