# 科研 Agent 需求地图

一个面向产品、架构与工程团队的分层知识站点，把 44 个真实科研需求映射到 6 个工程模块和 3 个 AI 研究闭环。

## 信息架构

- `/`：大局观、六个工程模块、试点与优先顺序
- `/needs`：可按领域、工程模块和关键词筛选的 44 个需求
- `/capabilities`：6 个模块的 MVP、组件、接口、首批任务与验收脚本
- `/loops`：3 个 AI 研究闭环的步骤、人类闸门和硬验收
- `/submit`：按统一格式提交需求，最终保存为公开 GitHub Issue

## 本地运行

```bash
npm install
npm run dev
npm run build
```

## 公开发布

推送到 SciForge 的 `gui` 分支后，GitHub Actions 会执行 `npm run build:pages`，
并将静态产物发布到 GitHub Pages。站点本身不保存数据；需求只有在 GitHub 上
最终提交后才会保存为公开 Issue。

站点使用 vinext 生成静态文件，不依赖数据库、后端服务或 Cloudflare Worker。
