# 安装与最小使用

## 从源码启动

需要 Node.js 22.12+、npm 和当前操作系统的原生编译工具。Electron、node-pty 等依赖包含下载或原生构建步骤，禁用安装脚本不能作为完整安装。

既有 `AGI4Sci/SciForge-client` 目前为 private，未来公开目的地尚未创建。先将 `SCIFORGE_CLIENT_REPOSITORY_URL` 设为维护者提供且你有权访问的地址；目的地就绪后再替换，不直接公开旧仓历史。以下为安装指引，不代表本候选已通过安装或运行验收。

```bash
: "${SCIFORGE_CLIENT_REPOSITORY_URL:?Set an authorized client repository URL}"
git clone "$SCIFORGE_CLIENT_REPOSITORY_URL" SciForge-client
cd SciForge-client
npm ci
npm run dev
```

`.env.local` 不是本地启动的必需文件。需要连接获授权的云端时，可复制 `.env.local.example` 并填写服务管理方提供的地址；不要提交密码、token 或 client secret。协作云端服务闭源，不随客户端安装。

启动后选择本地 workspace，在 Settings 中按需配置 Codex 或 Claude Code 等受支持的 runtime 和模型服务。未配置模型时，不应期待 Agent 完成模型任务。首次测试请使用新建空目录，勿使用真实项目数据。

## 开发验证

```bash
npm run typecheck
npm test
npm run build
```

详细功能说明见 https://hanhuiyang5-web.github.io/sciforge-docs-v2/ 。本轮未进行 Linux 实机验收，也未发布安装包。
