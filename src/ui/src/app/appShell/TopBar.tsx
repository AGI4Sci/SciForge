import { useState, type FormEvent } from 'react';
import { AppWindow, ChevronDown, MessageSquare, Monitor, Moon, PanelTop, Search, Settings, Sun } from 'lucide-react';
import type { DesktopAnnotationMode } from '../../config';
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
  onAnnotationModeSelect,
}: {
  onSearch: (query: string) => void;
  onSettingsOpen: () => void;
  theme: SciForgeConfig['theme'];
  onThemeToggle: () => void;
  healthItems: RuntimeHealthItem[];
  annotationModeActive?: boolean;
  onAnnotationModeToggle?: () => void;
  onAnnotationModeSelect?: (mode: DesktopAnnotationMode) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [annotationMenuOpen, setAnnotationMenuOpen] = useState(false);
  const healthProblems = healthItems.filter((item) => item.status === 'offline' || item.status === 'not-configured' || item.status === 'checking').length;
  const annotationModes: Array<{ mode: DesktopAnnotationMode; icon: typeof MessageSquare; label: string }> = [
    { mode: 'sciforge-page', icon: PanelTop, label: t({ 'zh-CN': 'SciForge 页面', 'en-US': 'SciForge page' }) },
    { mode: 'screen-region', icon: Monitor, label: t({ 'zh-CN': '屏幕区域', 'en-US': 'Screen region' }) },
    { mode: 'app-window', icon: AppWindow, label: t({ 'zh-CN': 'App 窗口', 'en-US': 'App window' }) },
  ];
  const annotationButtonLabel = annotationModeActive
    ? t({
      'zh-CN': '停止标注',
      'en-US': 'Stop Annotate',
    })
    : t({
      'zh-CN': '打开标注模式菜单',
      'en-US': 'Open Annotate mode menu',
    });
  const annotationButtonTitle = annotationModeActive
    ? t({
      'zh-CN': '停止当前全局标注。Global Vision 只负责屏幕感知，不会开始评论。',
      'en-US': 'Stop the current global annotation. Global Vision only senses screen; it does not start comments.',
    })
    : t({
      'zh-CN': 'Global Annotate：选择 SciForge page、Screen region 或 App window。Global Vision 只负责屏幕感知，不会开始评论。',
      'en-US': 'Global Annotate: choose SciForge page, Screen region, or App window. Global Vision only senses screen; it does not start comments.',
    });
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch(query);
  }
  function toggleAnnotationMenu() {
    if (annotationModeActive) {
      setAnnotationMenuOpen(false);
      onAnnotationModeToggle();
      return;
    }
    setAnnotationMenuOpen((current) => !current);
  }
  function selectAnnotationMode(mode: DesktopAnnotationMode) {
    setAnnotationMenuOpen(false);
    if (onAnnotationModeSelect) {
      onAnnotationModeSelect(mode);
      return;
    }
    onAnnotationModeToggle();
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
        <div className="topbar-annotation-menu">
          <button
            type="button"
            className={cx('topbar-annotation-button', annotationModeActive && 'active')}
            onClick={toggleAnnotationMenu}
            aria-pressed={annotationModeActive}
            aria-haspopup="menu"
            aria-expanded={annotationMenuOpen}
            aria-label={annotationButtonLabel}
            title={annotationButtonTitle}
            data-feedback-control="true"
          >
            <MessageSquare size={15} aria-hidden />
            <span>{t({ 'zh-CN': '标注', 'en-US': 'Annotate' })}</span>
            <ChevronDown size={13} aria-hidden />
          </button>
          {annotationMenuOpen ? (
            <div className="topbar-annotation-menu-popover" role="menu" data-feedback-control="true">
              {annotationModes.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.mode} type="button" role="menuitem" data-annotation-mode={item.mode} onClick={() => selectAnnotationMode(item.mode)}>
                    <Icon size={14} aria-hidden />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
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
