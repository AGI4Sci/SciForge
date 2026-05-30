import { useState, type FormEvent } from 'react';
import { MessageSquare, Moon, Search, Settings, Sun } from 'lucide-react';
import type { SciForgeConfig } from '../../domain';
import { useI18n } from '../../i18nContext';
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
  const { t } = useI18n();
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
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t({ 'zh-CN': '搜索文件、报告、问题...', 'en-US': 'Search files, reports, questions...' })}
        />
      </form>
      <div className="topbar-actions">
        <button
          type="button"
          className={cx('topbar-annotation-button', annotationModeActive && 'active')}
          onClick={onAnnotationModeToggle}
          aria-pressed={annotationModeActive}
          aria-label={annotationModeActive
            ? t({ 'zh-CN': '暂停标注选择', 'en-US': 'Pause annotation picking' })
            : t({ 'zh-CN': '打开标注', 'en-US': 'Open annotations' })}
          data-feedback-control="true"
        >
          <MessageSquare size={15} aria-hidden />
          <span>{t({ 'zh-CN': '标注', 'en-US': 'Annotate' })}</span>
        </button>
        <Badge variant={healthProblems ? 'warning' : 'success'} glow>
          SciForge · {healthProblems
            ? t({ 'zh-CN': `${healthProblems} 个问题`, 'en-US': `${healthProblems} issue${healthProblems === 1 ? '' : 's'}` })
            : t({ 'zh-CN': '就绪', 'en-US': 'Ready' })}
        </Badge>
        <IconButton
          icon={(theme ?? 'dark') === 'dark' ? Sun : Moon}
          label={(theme ?? 'dark') === 'dark' ? t({ 'zh-CN': '浅色模式', 'en-US': 'Light mode' }) : t({ 'zh-CN': '深色模式', 'en-US': 'Dark mode' })}
          onClick={onThemeToggle}
        />
        <IconButton icon={Settings} label={t({ 'zh-CN': '设置', 'en-US': 'Settings' })} onClick={onSettingsOpen} />
      </div>
    </header>
  );
}
