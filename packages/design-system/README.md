# SciForge Design System

`packages/design-system` 是 SciForge 的语义主题 token 与低层 React primitives 包。它刻意保持小而稳定：页面可以保留自己的科研领域布局，重复控件、交互状态和基础视觉语言由本包提供。

## Agent 快速契约

新增页面控件前，优先使用这些 primitives：

- `Button` / `ActionButton`：图标加文字的命令按钮，支持 `primary`、`secondary`、`ghost`、`coral`、`danger`。
- `IconButton`：方形图标按钮，必须带 `aria-label`、title，以及来自 `label` 的 tooltip 文本。
- `Badge`：紧凑状态文本，支持 `info`、`success`、`warning`、`danger`、`muted`、`coral`。
- `Card` / `Panel`：用于重复对象、摘要和工具面板的有边界表面。
- `TabBar`：少量模式切换的分段导航。
- `SectionHeader`：标题、可选图标/副标题和可选 action slot。
- `EmptyState`：空态、加载态和可恢复占位。
- `Input`、`Select`、`Details`：基于 token 的表单与折叠控件。

主题 token 是语义 CSS 变量。优先使用 `--surface`、`--surface-muted`、`--surface-raised`、`--border`、`--border-strong`、`--text-primary`、`--text-secondary`、`--text-muted`、`--accent`、`--danger`、`--warning`、`--shadow`、`--focus-ring`、`--radius` 和 `--space-*`，避免页面局部硬编码颜色或间距。

应用应在 UI 祖先节点上只挂载一个主题类：`theme-dark` 或 `theme-light`。默认主题通过 `:root` 提供；light override 与 dark token 放在同一 token 层。

## 设计原则

SciForge 应像一个专注的科研工作台：信息密度足够支撑重复劳动，状态表达清晰，视觉上安静耐看。Card 用于单个重复对象或紧凑工具面板，不用于把整段页面装进浮动装饰框。

按钮应在动作可识别时使用图标；纯图标按钮必须保留可访问名称。新增 primitive 应能在没有业务数据时独立渲染，不应 import SciForge runtime、session 或 scenario 类型。

## 扩展规则

- 新颜色、新间距和新状态优先抽象为语义 token。
- 默认圆角保持在 8px 或以下，除非组件有明确理由。
- 表单、按钮、tabs、badge 和 empty state 的 hover/focus/disabled 状态必须完整。
- 低层 primitives 不直接读取 workspace、不调用 AgentServer、不操作 Computer Use，也不负责 verifier verdict。
- 面向 artifact 的复杂展示应放在 `packages/ui-components` 或长期别名 `packages/interactive-views`。
