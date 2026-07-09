# SciForge Canvas draw.io 迁移计划

## 目标

将现有基于 tldraw 的 SciForge Canvas 迁移为基于 draw.io/diagrams.net 的画布编辑器，同时保留当前 Canvas MCP、artifact 插入、审改包导出和主聊天图片/PPT 点击进入画布的工作流。

## 设计原则

- draw.io 只负责人类可视化编辑、连线、批注、框选、排版和导出。
- SciForge Canvas worker 继续负责 workspace 内存储、artifact manifest、审改包和 MCP 安全边界。
- 不把图片二进制塞进聊天消息；图片仍以文件路径和 manifest 流转。
- 旧 tldraw 数据先只读兼容，不在第一步强制删除或覆盖。
- PPT、科研绘图、图片生成的 MCP 协议保持稳定。

## 分阶段实现

### v1：双轨存储与 draw.io 默认打开

- 在 `.sciforge/canvases/<canvasId>/` 下新增 `canvas.drawio.xml`。
- `open_or_create` 返回 draw.io XML，同时保留旧 `canvas.json` 作为 legacy snapshot。
- `insert_artifact` 改为向 draw.io XML 插入 image/placeholder cell，并保留 artifact metadata。
- `export_review_packet` 从 draw.io XML 和 selection/annotation metadata 中导出审改包。
- 前端 Canvas 面板嵌入 draw.io iframe，通过 `postMessage` load/save/autosave。

### v2：完善审改语义

- 将 draw.io 选中的 cell 转换为 SciForge selection。
- 对箭头、矩形框、文本批注、callout 建立统一 metadata。
- “发送修改”只导出 review packet 并发简短请求，不在聊天框展示长路径和实现细节。

### v3：深度编辑与导出

- 支持 draw.io 原生导出 PNG/SVG/PDF。
- 支持多 panel figure 的 draw.io 版式编排。
- 支持从 Canvas 反向生成 controlled plotting/image-generation edit spec。

## 风险与处理

- draw.io iframe 需要 embed URL。默认优先本地/self-host `VITE_SCIFORGE_DRAWIO_EMBED_URL`，不静默连接在线 diagrams.net；开发测试时可由用户在 UI 中一次性启用在线 draw.io。
- 本地图片在远程 iframe 中不能直接读 workspace 路径。v1 通过 worker 生成可嵌入 image data 或受控资源引用，后续再接专用 asset URL。
- draw.io XML 与 tldraw snapshot 结构不同。v1 不做完整双向迁移，只迁移 artifact/annotation 级别语义。

## 验收

- 打开图风格面板的“画布审改”页时加载 draw.io 画布。
- 主聊天图片/PPT artifact 点击后可插入并显示在 draw.io 画布中。
- 可在 draw.io 中添加文字、框、箭头、连线并保存。
- 审改包包含 artifact、批注、bounds、metadata，不包含图片二进制。
- 现有四个 worker MCP 仍只暴露少量顶层工具。
